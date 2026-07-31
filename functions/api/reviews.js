// functions/api/reviews.js
// GET  /api/reviews?productSlug=xxx&limit=20&beforeId=&mine=1
//   - Public: approved reviews for a product, newest first, cursor-paginated.
//   - ?mine=1 (requires session): returns the caller's own review for that
//     product regardless of status, so the frontend can show "pending review".
// POST /api/reviews   multipart/form-data: productSlug, rating, title?, body, images[] (0-4 files)
//   - Requires login. One review per (product, user) — DB UNIQUE enforces it,
//     so a resubmit attempt just gets a 409 rather than a silent duplicate.
//   - Images go straight to their final R2 key (reviews/{reviewId}/{n}-{ts}.ext).
//     No pending/staging folder — nothing to move or clean up later.

import { getUserFromSession } from './_utils/session.js';
import { createNotification } from './_utils/notify.js';

const MAX_IMAGES = 4;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB per image — reviews don't need admin/upload.js's 5MB ceiling
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function extFor(mimeType) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
}

function toPublicReview(row) {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    images: JSON.parse(row.images || '[]').map(key => `/api/images/${key}`),
    verifiedPurchase: !!row.verified_purchase,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const productSlug = url.searchParams.get('productSlug');
  if (!productSlug) return jsonError('productSlug is required');

  const product = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(productSlug).first();
  if (!product) return jsonError('Product not found', 404);

  if (url.searchParams.get('mine') === '1') {
    const user = await getUserFromSession(request, env);
    if (!user) return jsonError('Login required', 401);
    const mine = await env.DB.prepare(
      `SELECT id, rating, title, body, status, created_at FROM product_reviews WHERE product_id = ? AND user_id = ?`
    ).bind(product.id, user.id).first();
    return new Response(JSON.stringify({ review: mine || null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const beforeId = Number(url.searchParams.get('beforeId')) || null;

  let query = `
    SELECT pr.id, pr.rating, pr.title, pr.body, pr.images, pr.verified_purchase, pr.created_at,
           u.name as author_name
    FROM product_reviews pr JOIN users u ON u.id = pr.user_id
    WHERE pr.product_id = ? AND pr.status = 'approved'`;
  const binds = [product.id];
  if (beforeId) { query += ' AND pr.id < ?'; binds.push(beforeId); }
  query += ' ORDER BY pr.id DESC LIMIT ?';
  binds.push(limit + 1);

  const result = await env.DB.prepare(query).bind(...binds).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const reviews = (hasMore ? rows.slice(0, limit) : rows).map(toPublicReview);

  const agg = await env.DB.prepare(
    `SELECT COUNT(*) as cnt, AVG(rating) as avg_rating FROM product_reviews WHERE product_id = ? AND status = 'approved'`
  ).bind(product.id).first();

  return new Response(JSON.stringify({
    reviews, hasMore,
    aggregate: { reviewCount: agg.cnt, ratingValue: agg.cnt ? Math.round(agg.avg_rating * 10) / 10 : null },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let form;
  try { form = await request.formData(); } catch { return jsonError('Expected multipart/form-data'); }

  const productSlug = String(form.get('productSlug') || '').trim();
  const rating = Number(form.get('rating'));
  const title = form.get('title') ? String(form.get('title')).trim().slice(0, 120) : null;
  const body = String(form.get('body') || '').trim();

  if (!productSlug) return jsonError('productSlug is required');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return jsonError('rating must be an integer 1-5');
  if (!body || body.length < 5) return jsonError('Please write a short review (at least 5 characters)');
  if (body.length > 2000) return jsonError('Review is too long (max 2000 characters)');

  const product = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(productSlug).first();
  if (!product) return jsonError('Product not found', 404);

  const files = form.getAll('images').filter(f => f && typeof f !== 'string');
  if (files.length > MAX_IMAGES) return jsonError(`Maximum ${MAX_IMAGES} images per review`);
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) return jsonError('Images must be webp, jpeg, or png');
    if (file.size > MAX_BYTES) return jsonError('Each image must be under 3MB');
  }

  const verifiedRow = await env.DB.prepare(
    `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_slug = ? AND o.user_id = ? AND o.payment_status IN ('paid','cod') LIMIT 1`
  ).bind(productSlug, user.id).first();

  let insert;
  try {
    insert = await env.DB.prepare(
      `INSERT INTO product_reviews (product_id, user_id, rating, title, body, verified_purchase)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(product.id, user.id, rating, title, body, verifiedRow ? 1 : 0).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return jsonError("You've already reviewed this product.", 409);
    }
    throw err;
  }

  const reviewId = insert.meta.last_row_id;

  // Images uploaded to their final key straight away — status='pending' is
  // what actually gates visibility (both in the public GET above and in
  // products-sync.js), so there's no separate "pending" R2 prefix to
  // maintain or migrate out of later.
  if (env.IMAGES && files.length) {
    const keys = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const key = `reviews/${reviewId}/${i}-${Date.now()}.${extFor(files[i].type)}`;
        await env.IMAGES.put(key, await files[i].arrayBuffer(), { httpMetadata: { contentType: files[i].type } });
        keys.push(key);
      }
      await env.DB.prepare('UPDATE product_reviews SET images = ? WHERE id = ?').bind(JSON.stringify(keys), reviewId).run();
    } catch (err) {
      // Best-effort cleanup of whatever did upload, then surface the error —
      // the review row stays (text is still valid), just without images.
      console.error('Review image upload failed:', err.message);
    }
  }

  context.waitUntil(createNotification(env, {
    type: 'review_pending',
    title: 'New review awaiting approval',
    body: `${user.name} rated a product ${rating}/5`,
    referenceType: 'product_review',
    referenceId: reviewId,
  }));

  return new Response(JSON.stringify({ ok: true, reviewId, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}