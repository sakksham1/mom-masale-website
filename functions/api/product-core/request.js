// POST /api/product-core/request   { productId, field: 'name'|'price', payload }
// manager or admin only — this is the one D1 change that fans out to the
// public website, so it's kept to the two roles closest to the catalog.
// Decision + json sync lives in manager/approvals/decide.js (already built).

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';

const FIELDS = ['name', 'price'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['manager', 'admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, field, payload } = body;
  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!FIELDS.includes(field)) return jsonError(`field must be one of: ${FIELDS.join(', ')}`);
  if (!payload || typeof payload !== 'object') return jsonError('payload object is required');

  if (field === 'name' && !payload.name?.trim()) return jsonError('payload.name is required');
  if (field === 'price') {
    if (!payload.size) return jsonError('payload.size is required');
    if (!Number.isFinite(payload.price) || payload.price <= 0) return jsonError('payload.price must be a positive number');
  }

  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return jsonError('Product not found', 404);

  if (field === 'price') {
    const sizeRow = await env.DB.prepare(
      `SELECT id FROM product_sizes WHERE product_id = ? AND size = ?`
    ).bind(productId, payload.size).first();
    if (!sizeRow) return jsonError(`Product has no size "${payload.size}" to price`, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO product_core_change_requests (product_id, field, payload, requested_by) VALUES (?, ?, ?, ?)`
  ).bind(productId, field, JSON.stringify(payload), user.id).run();

  return new Response(JSON.stringify({ ok: true, requestId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}