// functions/api/admin/recipe-reviews.js
// GET   /api/admin/recipe-reviews?status=pending    — admin or manager
// PATCH /api/admin/recipe-reviews  { reviewId, decision, reason? }  — admin only
import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { syncRecipeReviewsIntoStaged } from '../_utils/recipe-blog-sync.js';
import { enqueueSync } from '../_utils/sync-queue.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'approved'].includes(status)) return jsonError('status must be pending or approved');

  const result = await env.DB.prepare(
    `SELECT rr.id, rr.recipe_slug, rr.rating, rr.title, rr.body, rr.images, rr.created_at,
            u.id as user_id, u.name as user_name, u.email as user_email
     FROM recipe_reviews rr JOIN users u ON u.id = rr.user_id
     WHERE rr.status = ? ORDER BY rr.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`
  ).bind(status).all();

  const reviews = (result.results || []).map(r => ({ ...r, images: JSON.parse(r.images || '[]').map(k => `/api/images/${k}`) }));
  return new Response(JSON.stringify({ reviews }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { reviewId, decision, reason } = body;
  if (!Number.isInteger(reviewId)) return jsonError('reviewId is required');
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');

  const review = await env.DB.prepare('SELECT id, images, status, recipe_slug FROM recipe_reviews WHERE id = ?').bind(reviewId).first();
  if (!review) return jsonError('Review not found', 404);
  if (review.status !== 'pending') return jsonError(`Already ${review.status}`, 409);

  if (decision === 'rejected') {
    const keys = JSON.parse(review.images || '[]');
    if (env.IMAGES) for (const key of keys) { try { await env.IMAGES.delete(key); } catch (e) { console.error('R2 delete failed:', key, e.message); } }
    await env.DB.prepare('DELETE FROM recipe_reviews WHERE id = ?').bind(reviewId).run();
    await logAudit(env, { userId: user.id, action: 'reject', resource: 'recipe_review', resourceId: reviewId, diff: { recipeSlug: review.recipe_slug, reason: reason || null } });
    return new Response(JSON.stringify({ ok: true, decision: 'rejected' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(`UPDATE recipe_reviews SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .bind(user.id, reviewId).run();

  // Fold into the staged recipes.json (not yet published to GitHub) —
  // same "approve now, publish later" model recipes.js/blog.js already use.
  await syncRecipeReviewsIntoStaged(env, review.recipe_slug, user.id);
  await enqueueSync(env, {
    sourceType: 'recipe_review', sourceId: reviewId, productSlug: null,
    summary: `New approved review for recipe "${review.recipe_slug}"`, createdBy: user.id,
  });

  await logAudit(env, { userId: user.id, action: 'approve', resource: 'recipe_review', resourceId: reviewId, diff: { recipeSlug: review.recipe_slug } });
  return new Response(JSON.stringify({ ok: true, decision: 'approved' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}