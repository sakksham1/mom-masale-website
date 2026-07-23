// functions/api/_utils/customer-notify.js
// Order-confirmation messages sent TO THE CUSTOMER (notify.js is your own
// admin/staff channel). Email is live now via Resend. WhatsApp is wired
// end-to-end but no-ops until WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID
// are set (wrangler secret put) — add those two secrets later, no code changes.

import { sendEmail } from './email.js';
import { formatOrderCode } from './order-code.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function rupee(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }

function orderConfirmationEmailHtml({ orderCode, items, total, paymentMethod }) {
  const itemsHtml = (items || [])
    .map(i => `<div>${escapeHtml(i.product_name)} (${escapeHtml(i.size)}) × ${i.qty} — ${rupee((i.unit_price || 0) * i.qty)}</div>`)
    .join('');
  const paymentLine = paymentMethod === 'cod' ? 'Payment: Cash on Delivery' : 'Payment: Received';

  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px">
      <h2 style="color:#7b1120;margin-bottom:4px">Order Confirmed 🎉</h2>
      <p style="color:#555;font-size:0.95rem;margin-bottom:16px">Order <strong>${escapeHtml(orderCode)}</strong></p>
      <div style="font-size:0.92rem;color:#333;line-height:1.7">${itemsHtml}</div>
      <p style="font-weight:700;margin-top:12px">Total: ${rupee(total)}</p>
      <p style="color:#555;font-size:0.9rem">${paymentLine}</p>
      <p style="color:#888;font-size:0.8rem;margin-top:16px">We'll reach out on WhatsApp or by phone to confirm delivery details.</p>
    </div>
  `;
}

export async function sendCustomerOrderConfirmationEmail(env, { to, orderCode, items, total, paymentMethod }) {
  if (!to) return;
  try {
    await sendEmail(env, {
      to,
      subject: `Order Confirmed — ${orderCode}`,
      html: orderConfirmationEmailHtml({ orderCode, items, total, paymentMethod }),
    });
  } catch (err) {
    console.error('Customer order confirmation email failed:', err.message);
  }
}

// No-ops until WhatsApp Business Cloud API credentials exist.
export async function sendCustomerOrderConfirmationWhatsApp(env, { phone, orderCode, total }) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`WhatsApp not configured — skipped customer confirmation for ${orderCode}`);
    return;
  }
  if (!phone) return;

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `91${phone}`,
        type: 'template',
        template: {
          name: env.WHATSAPP_ORDER_TEMPLATE_NAME || 'order_confirmation',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: orderCode }, { type: 'text', text: rupee(total) }] }],
        },
      }),
    });
    if (!res.ok) console.error('WhatsApp send failed:', await res.text());
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

// Shared by verify-payment.js and razorpay-webhook.js — both land here once
// payment_status flips to 'paid', handing over a fresh orders row.
export async function notifyCustomerPaymentConfirmed(env, order) {
  const orderCode = formatOrderCode(order.id, order.created_at);
  await Promise.allSettled([
    sendCustomerOrderConfirmationEmail(env, { to: order.email, orderCode, items: order.items || [], total: order.total, paymentMethod: 'razorpay' }),
    sendCustomerOrderConfirmationWhatsApp(env, { phone: order.phone, orderCode, total: order.total }),
  ]);
}