// functions/api/admin/reviews.js
// GET   /api/admin/reviews?status=pending    — admin or manager (visibility only)
// PATCH /api/admin/reviews  { reviewId, decision: 'approved'|'rejected', reason? }  — admin only
//
// Approve: flips status, re-syncs data/products.json (aggregateRating + a
//   handful of recent reviews) so the next site build emits real Review /
//   AggregateRating schema — same GitHub-commit pattern as every other
//   catalog write in this codebase.
// Reject: deletes the review's R2 images, then HARD-DELETES the row. Nothing
//   rejected is ever kept in D1 or R2 — the UNIQUE(product_id,user_id)
//   constraint disappears with the row, so the customer can fix and resubmit.

import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { enqueueSync } from '../_utils/sync-queue.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'approved'].includes(status)) return jsonError('status must be pending or approved');

  const result = await env.DB.prepare(
    `SELECT pr.id, pr.rating, pr.title, pr.body, pr.images, pr.verified_purchase, pr.created_at,
            p.slug as product_slug, p.name as product_name,
            u.id as user_id, u.name as user_name, u.email as user_email
     FROM product_reviews pr
     JOIN products p ON p.id = pr.product_id
     JOIN users u ON u.id = pr.user_id
     WHERE pr.status = ?
     ORDER BY pr.created_at ${status === 'pending' ? 'ASC' : 'DESC'}
     LIMIT 200`
  ).bind(status).all();

  const reviews = (result.results || []).map(r => ({
    ...r,
    images: JSON.parse(r.images || '[]').map(key => `/api/images/${key}`),
  }));

  return new Response(JSON.stringify({ reviews }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']); // decide is admin-only — it's a live-site write
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { reviewId, decision, reason } = body;
  if (!Number.isInteger(reviewId)) return jsonError('reviewId is required');
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');

  const review = await env.DB.prepare(
    `SELECT pr.id, pr.images, pr.status, p.slug as product_slug
     FROM product_reviews pr JOIN products p ON p.id = pr.product_id WHERE pr.id = ?`
  ).bind(reviewId).first();
  if (!review) return jsonError('Review not found', 404);
  if (review.status !== 'pending') return jsonError(`Already ${review.status}`, 409);

  if (decision === 'rejected') {
    const keys = JSON.parse(review.images || '[]');
    if (env.IMAGES) {
      for (const key of keys) {
        try { await env.IMAGES.delete(key); } catch (err) { console.error('R2 delete failed:', key, err.message); }
      }
    }
    await env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(reviewId).run();
    await logAudit(env, {
      userId: user.id, action: 'reject', resource: 'product_review', resourceId: reviewId,
      diff: { productSlug: review.product_slug, reason: reason || null },
    });
    return new Response(JSON.stringify({ ok: true, decision: 'rejected' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // approved
  await env.DB.prepare(
    `UPDATE product_reviews SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(user.id, reviewId).run();

  await enqueueSync(env, {
    sourceType: 'review',
    sourceId: reviewId,
    productSlug: review.product_slug,
    summary: `New approved review for ${review.product_slug}`,
    createdBy: user.id,
  });

  await logAudit(env, {
    userId: user.id, action: 'approve', resource: 'product_review', resourceId: reviewId,
    diff: { productSlug: review.product_slug },
  });

  return new Response(JSON.stringify({ ok: true, decision: 'approved' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}