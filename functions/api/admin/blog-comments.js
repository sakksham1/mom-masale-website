// functions/api/admin/blog-comments.js
// GET   /api/admin/blog-comments?status=pending    — admin or manager (visibility only)
// PATCH /api/admin/blog-comments  { commentId, decision: 'approved'|'rejected', reason? }  — admin only
//
// Approve: flips status, re-syncs data/blog.json's embedded `comments` array
//   for that post (via syncBlogCommentsIntoStaged) and enqueues a publish-
//   queue row — nothing goes live until an admin runs the next Publish,
//   same as every other blog edit.
// Reject: hard-deletes the row. No images to clean up (comments are plain
//   text), unlike recipe-reviews.js's reject path.

import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { syncBlogCommentsIntoStaged } from '../_utils/recipe-blog-sync.js';
import { enqueueSync } from '../_utils/sync-queue.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'approved'].includes(status)) return jsonError('status must be pending or approved');

  const result = await env.DB.prepare(
    `SELECT bc.id, bc.blog_slug, bc.body, bc.created_at,
            u.id as user_id, u.name as user_name, u.email as user_email
     FROM blog_comments bc
     JOIN users u ON u.id = bc.user_id
     WHERE bc.status = ?
     ORDER BY bc.created_at ${status === 'pending' ? 'ASC' : 'DESC'}
     LIMIT 200`
  ).bind(status).all();

  return new Response(JSON.stringify({ comments: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']); // decide is admin-only — it's a live-site write
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { commentId, decision, reason } = body;
  if (!Number.isInteger(commentId)) return jsonError('commentId is required');
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');

  const comment = await env.DB.prepare(
    `SELECT id, status, blog_slug FROM blog_comments WHERE id = ?`
  ).bind(commentId).first();
  if (!comment) return jsonError('Comment not found', 404);
  if (comment.status !== 'pending') return jsonError(`Already ${comment.status}`, 409);

  if (decision === 'rejected') {
    await env.DB.prepare('DELETE FROM blog_comments WHERE id = ?').bind(commentId).run();
    await logAudit(env, {
      userId: user.id, action: 'reject', resource: 'blog_comment', resourceId: commentId,
      diff: { blogSlug: comment.blog_slug, reason: reason || null },
    });
    return new Response(JSON.stringify({ ok: true, decision: 'rejected' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // approved
  await env.DB.prepare(
    `UPDATE blog_comments SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(user.id, commentId).run();

  // Fold into the staged blog.json (not yet published to GitHub) — same
  // "approve now, publish later" model recipes.js/blog.js already use.
  await syncBlogCommentsIntoStaged(env, comment.blog_slug, user.id);

  await enqueueSync(env, {
    sourceType: 'blog_comment',
    sourceId: commentId,
    productSlug: null,
    summary: `New approved comment on "${comment.blog_slug}"`,
    createdBy: user.id,
  });

  await logAudit(env, {
    userId: user.id, action: 'approve', resource: 'blog_comment', resourceId: commentId,
    diff: { blogSlug: comment.blog_slug },
  });

  return new Response(JSON.stringify({ ok: true, decision: 'approved' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}