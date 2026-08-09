// functions/api/coupon-core/request.js
// POST /api/coupon-core/request   { action: 'create'|'update', couponId?, payload }
//
// manager or admin. Mirrors product-core/request.js exactly: admins should
// just call POST/PATCH /api/admin/coupons directly instead of filing a
// request for a change they can already approve themselves.
//
// 'create' — payload is the full new-coupon shape (same fields as
//   POST /api/admin/coupons body).
// 'update' — couponId required, payload is a partial updates object (same
//   shape as PATCH /api/admin/coupons's `updates`).
//
// Decision + actual DB write lives in manager/approvals/decide.js.

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';
import { createNotification } from '../_utils/notify.js';
import { normalizeCode } from '../_utils/coupons.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['manager', 'admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { action, couponId, payload } = body;
  if (!['create', 'update'].includes(action)) return jsonError('action must be "create" or "update"');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('payload object is required');
  }

  if (action === 'update') {
    if (!Number.isInteger(couponId)) return jsonError('couponId is required for an update request');
    const coupon = await env.DB.prepare('SELECT id, code FROM site_coupons WHERE id = ?').bind(couponId).first();
    if (!coupon) return jsonError('Coupon not found', 404);
  }

  if (action === 'create') {
    const code = normalizeCode(payload.code);
    if (!code) return jsonError('payload.code is required');
    payload.code = code; // normalize before it's stored, so the approver sees the real code
  }

  const result = await env.DB.prepare(
    `INSERT INTO coupon_change_requests (coupon_id, action, payload, requested_by) VALUES (?, ?, ?, ?)`
  ).bind(action === 'update' ? couponId : null, action, JSON.stringify(payload), user.id).run();

  const label = action === 'create'
    ? `New coupon proposed: "${payload.code}"`
    : `Coupon update proposed for #${couponId}`;

  context.waitUntil(createNotification(env, {
    type: 'approval_requested',
    title: 'Coupon change pending',
    body: `${label} — requested by ${user.name}`,
    referenceType: 'coupon_core',
    referenceId: result.meta.last_row_id,
  }));

  return new Response(JSON.stringify({ ok: true, requestId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}