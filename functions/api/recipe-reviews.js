// functions/api/recipe-reviews.js
// GET  /api/recipe-reviews?recipeSlug=xxx&limit=20&beforeId=&mine=1
// POST /api/recipe-reviews  multipart/form-data: recipeSlug, rating, title?, body, images[] (0-4)
import { getUserFromSession } from './_utils/session.js';
import { createNotification } from './_utils/notify.js';
import { readStagedOrLive } from './_utils/content-staging.js';

const MAX_IMAGES = 4;
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
function extFor(mimeType) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
}
function toPublicReview(row) {
  return {
    id: row.id, rating: row.rating, title: row.title, body: row.body,
    images: JSON.parse(row.images || '[]').map(key => `/api/images/${key}`),
    authorName: row.author_name, createdAt: row.created_at,
  };
}
async function recipeExists(env, slug) {
  const { content } = await readStagedOrLive(env, 'recipes', 'data/recipes.json');
  return JSON.parse(content).some(r => r.slug === slug);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const recipeSlug = url.searchParams.get('recipeSlug');
  if (!recipeSlug) return jsonError('recipeSlug is required');

  if (url.searchParams.get('mine') === '1') {
    const user = await getUserFromSession(request, env);
    if (!user) return jsonError('Login required', 401);
    const mine = await env.DB.prepare(
      `SELECT id, rating, title, body, status, created_at FROM recipe_reviews WHERE recipe_slug = ? AND user_id = ?`
    ).bind(recipeSlug, user.id).first();
    return new Response(JSON.stringify({ review: mine || null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const beforeId = Number(url.searchParams.get('beforeId')) || null;

  let query = `
    SELECT rr.id, rr.rating, rr.title, rr.body, rr.images, rr.created_at, u.name as author_name
    FROM recipe_reviews rr JOIN users u ON u.id = rr.user_id
    WHERE rr.recipe_slug = ? AND rr.status = 'approved'`;
  const binds = [recipeSlug];
  if (beforeId) { query += ' AND rr.id < ?'; binds.push(beforeId); }
  query += ' ORDER BY rr.id DESC LIMIT ?';
  binds.push(limit + 1);

  const result = await env.DB.prepare(query).bind(...binds).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const reviews = (hasMore ? rows.slice(0, limit) : rows).map(toPublicReview);

  const agg = await env.DB.prepare(
    `SELECT COUNT(*) as cnt, AVG(rating) as avg_rating FROM recipe_reviews WHERE recipe_slug = ? AND status = 'approved'`
  ).bind(recipeSlug).first();

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

  const recipeSlug = String(form.get('recipeSlug') || '').trim();
  const rating = Number(form.get('rating'));
  const title = form.get('title') ? String(form.get('title')).trim().slice(0, 120) : null;
  const body = String(form.get('body') || '').trim();

  if (!recipeSlug) return jsonError('recipeSlug is required');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return jsonError('rating must be an integer 1-5');
  if (!body || body.length < 5) return jsonError('Please write a short review (at least 5 characters)');
  if (body.length > 2000) return jsonError('Review is too long (max 2000 characters)');
  if (!(await recipeExists(env, recipeSlug))) return jsonError('Recipe not found', 404);

  const files = form.getAll('images').filter(f => f && typeof f !== 'string');
  if (files.length > MAX_IMAGES) return jsonError(`Maximum ${MAX_IMAGES} images per review`);
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) return jsonError('Images must be webp, jpeg, or png');
    if (file.size > MAX_BYTES) return jsonError('Each image must be under 3MB');
  }

  let insert;
  try {
    insert = await env.DB.prepare(
      `INSERT INTO recipe_reviews (recipe_slug, user_id, rating, title, body) VALUES (?, ?, ?, ?, ?)`
    ).bind(recipeSlug, user.id, rating, title, body).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return jsonError("You've already reviewed this recipe.", 409);
    throw err;
  }

  const reviewId = insert.meta.last_row_id;

  if (env.IMAGES && files.length) {
    const keys = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const key = `recipe-reviews/${reviewId}/${i}-${Date.now()}.${extFor(files[i].type)}`;
        await env.IMAGES.put(key, await files[i].arrayBuffer(), { httpMetadata: { contentType: files[i].type } });
        keys.push(key);
      }
      await env.DB.prepare('UPDATE recipe_reviews SET images = ? WHERE id = ?').bind(JSON.stringify(keys), reviewId).run();
    } catch (err) {
      console.error('Recipe review image upload failed:', err.message);
    }
  }

  context.waitUntil(createNotification(env, {
    type: 'recipe_review_pending',
    title: 'New recipe review awaiting approval',
    body: `${user.name} rated "${recipeSlug}" ${rating}/5`,
    referenceType: 'recipe_review',
    referenceId: reviewId,
  }));

  return new Response(JSON.stringify({ ok: true, reviewId, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}