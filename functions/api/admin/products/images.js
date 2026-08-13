// GET    /api/admin/products/images?productId=123     — list gallery images (admin + manager)
// POST   /api/admin/products/images  { productId, image, alt? }
// PATCH  /api/admin/products/images  { id, updates: { alt?, sortOrder? } }
// DELETE /api/admin/products/images?id=...
//
// `image` must already be committed to the repo (POST /api/admin/upload,
// folder: 'products'). Writes are admin-only and go straight to D1, same as
// admin/products.js's PATCH — then queue a publish so data/products.json
// picks up the change on the next Publish.

import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { enqueueSync } from '../../_utils/sync-queue.js';

function rowToJson(row) {
  return { id: row.id, productId: row.product_id, image: row.image, alt: row.alt, sortOrder: row.sort_order };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const productId = Number(url.searchParams.get('productId'));
  if (!Number.isInteger(productId)) return jsonError('productId query param is required');

  const result = await env.DB.prepare(
    `SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id`
  ).bind(productId).all();
  return new Response(JSON.stringify({ images: (result.results || []).map(rowToJson) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const productId = Number(body.productId);
  const image = (body.image || '').trim();
  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!image) return jsonError('image is required');

  const product = await env.DB.prepare('SELECT id, slug, name FROM products WHERE id = ?').bind(productId).first();
  if (!product) return jsonError('Product not found', 404);

  const maxSort = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM product_images WHERE product_id = ?'
  ).bind(productId).first();

  const result = await env.DB.prepare(
    `INSERT INTO product_images (product_id, image, alt, sort_order) VALUES (?, ?, ?, ?)`
  ).bind(productId, image, body.alt || null, Number.isInteger(body.sortOrder) ? body.sortOrder : (maxSort?.m ?? -1) + 1).run();

  await enqueueSync(env, {
    sourceType: 'product_core', sourceId: product.id, productSlug: product.slug,
    summary: `${product.name} — gallery image added`, createdBy: user.id,
  });
  await logAudit(env, { userId: user.id, action: 'create', resource: 'product_image', resourceId: result.meta.last_row_id, diff: { productId, image } });

  const row = await env.DB.prepare('SELECT * FROM product_images WHERE id = ?').bind(result.meta.last_row_id).first();
  return new Response(JSON.stringify({ ok: true, image: rowToJson(row) }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { id, updates } = body;
  if (!Number.isInteger(id)) return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const existing = await env.DB.prepare(
    `SELECT pi.id, pi.product_id, p.slug, p.name FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ?`
  ).bind(id).first();
  if (!existing) return jsonError('Image not found', 404);

  const sets = [];
  const binds = [];
  if ('alt' in updates) { sets.push('alt = ?'); binds.push(updates.alt || null); }
  if ('sortOrder' in updates) { sets.push('sort_order = ?'); binds.push(updates.sortOrder); }
  if (!sets.length) return jsonError('No editable fields provided');
  binds.push(id);

  await env.DB.prepare(`UPDATE product_images SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  await enqueueSync(env, {
    sourceType: 'product_core', sourceId: existing.product_id, productSlug: existing.slug,
    summary: `${existing.name} — gallery image updated`, createdBy: user.id,
  });
  await logAudit(env, { userId: user.id, action: 'update', resource: 'product_image', resourceId: id, diff: updates });

  const row = await env.DB.prepare('SELECT * FROM product_images WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ ok: true, image: rowToJson(row) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return jsonError('id query param is required');

  const existing = await env.DB.prepare(
    `SELECT pi.id, pi.product_id, p.slug, p.name FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ?`
  ).bind(id).first();
  if (!existing) return jsonError('Image not found', 404);

  await env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(id).run();

  await enqueueSync(env, {
    sourceType: 'product_core', sourceId: existing.product_id, productSlug: existing.slug,
    summary: `${existing.name} — gallery image removed`, createdBy: user.id,
  });
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'product_image', resourceId: id });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}