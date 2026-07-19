// functions/api/admin/inventory/adjust.js
// POST /api/admin/inventory/adjust   { productId, size, changeQty, reason?, note? }
//
// changeQty is a signed delta (+10 to restock, -3 to correct a count down).
// The UPDATE's WHERE clause guards against going negative in the same
// statement that applies the change — no read-then-write race window.
// Every adjustment is logged to inventory_movements, which is the real
// audit trail (stock_qty on product_sizes is just a maintained cache of it).

import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

const VALID_REASONS = ['restock', 'adjustment', 'damaged', 'correction'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, size, note } = body;
  const changeQty = Number(body.changeQty);
  const reason = VALID_REASONS.includes(body.reason) ? body.reason : 'adjustment';

  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!size) return jsonError('size is required');
  if (!Number.isInteger(changeQty) || changeQty === 0) return jsonError('changeQty must be a non-zero integer');

  const row = await env.DB.prepare(
    'SELECT id, stock_qty FROM product_sizes WHERE product_id = ? AND size = ?'
  ).bind(productId, size).first();
  if (!row) return jsonError('No matching product size found', 404);

  const result = await env.DB.prepare(
    `UPDATE product_sizes SET stock_qty = stock_qty + ? WHERE id = ? AND stock_qty + ? >= 0`
  ).bind(changeQty, row.id, changeQty).run();

  if (result.meta.changes === 0) {
    return jsonError(`That would take stock negative (currently ${row.stock_qty}, change ${changeQty})`, 409);
  }

  await env.DB.prepare(
    `INSERT INTO inventory_movements (product_id, size, change_qty, reason, user_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(productId, size, changeQty, reason, user.id, note || null).run();

  const updated = await env.DB.prepare(
    'SELECT stock_qty FROM product_sizes WHERE id = ?'
  ).bind(row.id).first();

  await logAudit(env, {
    userId: user.id, action: 'adjust', resource: 'inventory', resourceId: `${productId}:${size}`,
    diff: { changeQty, reason, note, newStockQty: updated.stock_qty },
  });

  return new Response(JSON.stringify({ ok: true, stockQty: updated.stock_qty }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
