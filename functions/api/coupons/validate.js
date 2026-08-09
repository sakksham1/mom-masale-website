// functions/api/coupons/validate.js
// POST /api/coupons/validate  { code, subtotal }
// Requires login (checkout does too) — preview only, never redeems.

import { getUserFromSession } from '../_utils/session.js';
import { validateCoupon } from '../_utils/coupons.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Please log in to apply a coupon.', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const subtotal = Number(body.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) return jsonError('Invalid subtotal');

  const result = await validateCoupon(env, { code: body.code, userId: user.id, subtotal });
  if (!result.valid) return jsonError(result.error, 400);

  return new Response(JSON.stringify({
    valid: true,
    code: result.coupon.code,
    description: result.coupon.description,
    discountAmount: result.discountAmount,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}