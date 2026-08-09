// functions/api/_utils/coupons.js
// Server-side coupon logic shared by checkout.js (authoritative charge) and
// coupons/validate.js (pre-checkout preview). Both call computeDiscount()
// so the preview a customer sees and the amount actually charged can never
// disagree — same pattern as resolveShipping() in _utils/shipping.js.

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Pure calculation — no DB writes. Returns { valid, error, discountAmount, coupon }.
export function computeDiscount(coupon, subtotal) {
  if (subtotal < coupon.min_subtotal) {
    return { valid: false, error: `This code needs a minimum order of ₹${coupon.min_subtotal}` };
  }

  let discount;
  if (coupon.type === 'percent') {
    discount = Math.round(subtotal * (coupon.value / 100));
    if (Number.isInteger(coupon.max_discount_amount)) {
      discount = Math.min(discount, coupon.max_discount_amount);
    }
  } else { // 'flat'
    discount = coupon.value;
  }
  discount = Math.min(discount, subtotal); // never discount past ₹0

  return { valid: true, discountAmount: discount };
}

// Fetches + runs every eligibility check except the atomic usage-limit
// guard (that happens at redeem time, since it needs a write). Returns
// { valid, error, coupon } or { valid: true, coupon, discountAmount }.
export async function validateCoupon(env, { code, userId, subtotal }) {
  const normalized = normalizeCode(code);
  if (!normalized) return { valid: false, error: 'Enter a coupon code' };

  const coupon = await env.DB.prepare(
    `SELECT * FROM site_coupons WHERE code = ? AND is_active = 1`
  ).bind(normalized).first();
  if (!coupon) return { valid: false, error: 'Invalid or expired coupon code' };

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { valid: false, error: 'This coupon is not active yet' };
  }
  if (coupon.ends_at && new Date(coupon.ends_at) < now) {
    return { valid: false, error: 'This coupon has expired' };
  }
  if (Number.isInteger(coupon.usage_limit) && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, error: 'This coupon has been fully redeemed' };
  }

  if (userId) {
    const userUsage = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?`
    ).bind(coupon.id, userId).first();
    if (userUsage.c >= coupon.per_user_limit) {
      return { valid: false, error: "You've already used this coupon the maximum number of times" };
    }
  }

  const calc = computeDiscount(coupon, subtotal);
  if (!calc.valid) return calc;

  return { valid: true, coupon, discountAmount: calc.discountAmount };
}

// Atomically claims one redemption slot (guarded UPDATE, same pattern as
// product_sizes.stock_qty in checkout.js) then logs the redemption row.
// Call this ONLY after the order row already exists, so order_id is real.
export async function redeemCoupon(env, { couponId, userId, orderId, discountAmount }) {
  const claim = await env.DB.prepare(
    `UPDATE site_coupons SET used_count = used_count + 1, updated_at = datetime('now')
     WHERE id = ? AND (usage_limit IS NULL OR used_count < usage_limit)`
  ).bind(couponId).run();

  if (claim.meta.changes === 0) {
    throw Object.assign(new Error('This coupon has just been fully redeemed'), { code: 'coupon_exhausted' });
  }

  await env.DB.prepare(
    `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_amount) VALUES (?, ?, ?, ?)`
  ).bind(couponId, userId, orderId, discountAmount).run();
}

// Mirrors restoreStock() in checkout.js — called if order creation fails
// after a coupon was already claimed (e.g. Razorpay order creation fails).
export async function rollbackCouponRedemption(env, { couponId, orderId }) {
  await env.DB.prepare(
    `UPDATE site_coupons SET used_count = MAX(0, used_count - 1), updated_at = datetime('now') WHERE id = ?`
  ).bind(couponId).run();
  await env.DB.prepare(
    `DELETE FROM coupon_redemptions WHERE coupon_id = ? AND order_id = ?`
  ).bind(couponId, orderId).run();
}