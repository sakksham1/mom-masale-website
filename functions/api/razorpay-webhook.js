// functions/api/razorpay-webhook.js
// POST /api/razorpay-webhook
//
// Configure this URL (https://mommasale.com/api/razorpay-webhook) in the
// Razorpay dashboard under Settings → Webhooks, subscribed to at least
// "payment.captured" and "payment.failed". This exists as a backup to
// verify-payment.js: if a customer pays but closes the tab before the
// Checkout.js success handler fires, this is what still marks the order paid.

import { verifyWebhookSignature } from './_utils/razorpay.js';
import { notifyPaymentConfirmed } from './_utils/notify.js';

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
      const result = await env.DB.prepare(
        `UPDATE orders
         SET payment_status = 'paid',
             razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
             updated_at = datetime('now')
         WHERE razorpay_order_id = ? AND payment_status != 'paid'
         RETURNING id, customer_name, total`
      ).bind(razorpayPaymentId || null, razorpayOrderId).all();

      // RETURNING only yields a row if this UPDATE was the one that actually
      // flipped payment_status — i.e. verify-payment.js hasn't already done
      // it. That's what prevents a duplicate notification when both paths
      // fire for the same order (see the CRITICAL note in checkout.js).
      const row = result.results && result.results[0];
      if (row) {
        context.waitUntil(notifyPaymentConfirmed(env, {
          orderId: row.id, customerName: row.customer_name, total: row.total,
        }));
      }
    }
  }

  if (event === 'payment.failed') {
    const paymentEntity = payload.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;

    if (razorpayOrderId) {
      // Guarded the same way as the payment.captured branch above: the
      // WHERE clause only matches (and RETURNING only yields a row) the
      // first time this fires for a given order. Razorpay retries webhook
      // deliveries on non-2xx responses, and without this guard a retry
      // would restore stock a second time for the same failed order.
      const result = await env.DB.prepare(
        `UPDATE orders
         SET payment_status = 'failed', updated_at = datetime('now')
         WHERE razorpay_order_id = ? AND payment_status NOT IN ('paid', 'failed')
         RETURNING id`
      ).bind(razorpayOrderId).all();

      const row = result.results && result.results[0];
      if (row) {
        const itemsResult = await env.DB.prepare(
          `SELECT product_slug, size, qty FROM order_items WHERE order_id = ?`
        ).bind(row.id).all();

        for (const item of itemsResult.results || []) {
          await env.DB.prepare(
            `UPDATE product_sizes SET stock_qty = stock_qty + ?
             WHERE product_id = (SELECT id FROM products WHERE slug = ?) AND size = ?`
          ).bind(item.qty, item.product_slug, item.size).run();

          await env.DB.prepare(
            `INSERT INTO inventory_movements (product_id, size, change_qty, reason, reference_type, reference_id, note)
             SELECT id, ?, ?, 'sale_reversed', 'order', ?, 'razorpay payment.failed webhook'
             FROM products WHERE slug = ?`
          ).bind(item.size, item.qty, row.id, item.product_slug).run();
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
