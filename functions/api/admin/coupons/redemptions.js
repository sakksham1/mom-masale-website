// functions/api/admin/coupons/redemptions.js
// GET /api/admin/coupons/redemptions?couponId=123&limit=50
// Read-only usage history — who redeemed a coupon, on which order, for how
// much. admin + manager, same visibility as everything else in this file.

import { requireRole, forbidden, jsonError } from '../../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const couponId = Number(url.searchParams.get('couponId'));
  if (!Number.isInteger(couponId)) return jsonError('couponId query param is required');

  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  const coupon = await env.DB.prepare('SELECT id, code FROM site_coupons WHERE id = ?').bind(couponId).first();
  if (!coupon) return jsonError('Coupon not found', 404);

  const result = await env.DB.prepare(
    `SELECT r.id, r.user_id, u.name as user_name, u.email as user_email,
            r.order_id, r.discount_amount, r.created_at
     FROM coupon_redemptions r
     JOIN users u ON u.id = r.user_id
     WHERE r.coupon_id = ?
     ORDER BY r.created_at DESC
     LIMIT ?`
  ).bind(couponId, limit).all();

  return new Response(JSON.stringify({
    coupon: { id: coupon.id, code: coupon.code },
    redemptions: result.results || [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}