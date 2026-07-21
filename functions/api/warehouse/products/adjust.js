// functions/api/warehouse/products/adjust.js
// POST /api/warehouse/products/adjust   { productId, size, changeQty, reason, note? }
// warehouser only. Doesn't change stock_qty immediately — files a pending
// product_stock_transactions row that a manager/admin approves via
// /api/manager/approvals/decide. Mirrors warehouse/raw-materials/adjust.js.

import { requireRole, forbidden, jsonError } from '../../_utils/admin.js';
import { createNotification } from '../../_utils/notify.js';

const VALID_REASONS = ['restock', 'adjustment', 'damaged', 'correction'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['warehouser']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, size, note } = body;
  const changeQty = Number(body.changeQty);
  const reason = body.reason;

  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!size) return jsonError('size is required');
  if (!Number.isInteger(changeQty) || changeQty === 0) return jsonError('changeQty must be a non-zero integer');
  if (!VALID_REASONS.includes(reason)) return jsonError(`reason must be one of: ${VALID_REASONS.join(', ')}`);

  const row = await env.DB.prepare(
    `SELECT ps.id, ps.stock_qty, p.name as product_name
     FROM product_sizes ps JOIN products p ON p.id = ps.product_id
     WHERE ps.product_id = ? AND ps.size = ?`
  ).bind(productId, size).first();
  if (!row) return jsonError('No matching product size found', 404);

  if (row.stock_qty + changeQty < 0) {
    return jsonError(`That would take stock negative (currently ${row.stock_qty}, change ${changeQty})`);
  }

  const result = await env.DB.prepare(
    `INSERT INTO product_stock_transactions (product_id, size, change_qty, reason, note, requested_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(productId, size, changeQty, reason, note || null, user.id).run();

  context.waitUntil(createNotification(env, {
    type: 'approval_requested',
    title: 'Product stock adjustment pending',
    body: `${row.product_name} (${size}): ${changeQty > 0 ? '+' : ''}${changeQty} (${reason}) — requested by ${user.name}`,
    referenceType: 'product_stock',
    referenceId: result.meta.last_row_id,
  }));

  return new Response(JSON.stringify({ ok: true, transactionId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}