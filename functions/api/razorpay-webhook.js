// functions/api/razorpay-webhook.js
// POST /api/razorpay-webhook
//
// Configure this URL (https://mommasale.com/api/razorpay-webhook) in the
// Razorpay dashboard under Settings → Webhooks, subscribed to at least
// "payment.captured" and "payment.failed". This exists as a backup to
// verify-payment.js: if a customer pays but closes the tab before the
// Checkout.js success handler fires, this is what still marks the order paid.

import { verifyWebhookSignature } from './_utils/razorpay.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text();
  const signature = request.headers.get('X-Razorpay-Signature');

  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  const valid = await verifyWebhookSignature(env, rawBody, signature);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = payload.event;

  if (event === 'payment.captured' || event === 'order.paid') {
    const paymentEntity = payload.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;

    if (razorpayOrderId) {
      await env.DB.prepare(
        `UPDATE orders
         SET payment_status = 'paid',
             razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
             updated_at = datetime('now')
         WHERE razorpay_order_id = ? AND payment_status != 'paid'`
      ).bind(razorpayPaymentId || null, razorpayOrderId).run();
    }
  }

  if (event === 'payment.failed') {
    const paymentEntity = payload.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;

    if (razorpayOrderId) {
      await env.DB.prepare(
        `UPDATE orders
         SET payment_status = 'failed', updated_at = datetime('now')
         WHERE razorpay_order_id = ? AND payment_status != 'paid'`
      ).bind(razorpayOrderId).run();
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
