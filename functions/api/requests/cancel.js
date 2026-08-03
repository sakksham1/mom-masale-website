// POST /api/requests/cancel   { type: 'packaging'|'raw_material'|'product_stock', id }
// Lets a requester withdraw their own request while it's still pending.
// Ownership + pending-only are enforced here, not role — any logged-in user
// can only ever cancel a row they themselves filed.

import { getUserFromSession } from '../_utils/session.js';
import { logAudit } from '../_utils/admin.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

const TABLE_CONFIG = {
  packaging: { table: 'packaging_reports', ownerColumn: 'user_id' },
  raw_material: { table: 'raw_material_transactions', ownerColumn: 'requested_by' },
  product_stock: { table: 'product_stock_transactions', ownerColumn: 'requested_by' },
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { type, id } = body;
  const config = TABLE_CONFIG[type];
  if (!config) return jsonError(`type must be one of: ${Object.keys(TABLE_CONFIG).join(', ')}`);
  if (!Number.isInteger(id)) return jsonError('id is required');

  const row = await env.DB.prepare(
    `SELECT id, status, ${config.ownerColumn} as owner_id FROM ${config.table} WHERE id = ?`
  ).bind(id).first();
  if (!row) return jsonError('Request not found', 404);
  if (row.owner_id !== user.id) return jsonError('You can only cancel your own requests', 403);
  if (row.status !== 'pending') return jsonError(`Cannot cancel — already ${row.status}`, 409);

  await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
  await logAudit(env, { userId: user.id, action: 'cancel', resource: type, resourceId: id });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}