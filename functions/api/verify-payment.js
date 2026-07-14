// functions/api/verify-payment.js
// POST /api/verify-payment
// Body: { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// This is the client-side confirmation path, called from Checkout.js's
// success handler. The webhook (razorpay-webhook.js) is the server-to-server
// backup for the same event — needed because a customer can close their
// browser tab right after paying, before this call ever fires.

import { verifyPaymentSignature } from './_utils/razorpay.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};

  if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return jsonError('Missing verification details');
  }

  const order = await env.DB.prepare(
    'SELECT id, razorpay_order_id FROM orders WHERE id = ?'
  ).bind(orderId).first();

  if (!order) return jsonError('Order not found', 404);
  if (order.razorpay_order_id !== razorpay_order_id) return jsonError('Order mismatch', 400);

  const valid = await verifyPaymentSignature(env, razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!valid) return jsonError('Payment verification failed', 400);

  await env.DB.prepare(
    `UPDATE orders SET payment_status = 'paid', razorpay_payment_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(razorpay_payment_id, orderId).run();

  return new Response(JSON.stringify({ success: true, orderId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
