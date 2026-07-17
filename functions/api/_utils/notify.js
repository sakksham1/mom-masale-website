// functions/api/_utils/notify.js
// Push-based admin notifications — fired from the exact moments an order is
// created or paid (checkout.js, verify-payment.js, razorpay-webhook.js).
// No polling, no cron: called inline and wrapped in context.waitUntil() by
// the caller so it completes even after the HTTP response has been sent.
//
// Requires env vars (wrangler secret put):
//   TELEGRAM_BOT_TOKEN   — from @BotFather
//   TELEGRAM_CHAT_ID     — your personal or group chat id
//   ADMIN_NOTIFY_EMAIL   — where order emails should land
// Reuses RESEND_API_KEY / RESEND_FROM already configured for OTP emails.

import { sendEmail } from './email.js';

export async function sendTelegramMessage(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('Telegram not configured — skipping notification');
    return;
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    console.error('Telegram send failed:', await res.text());
  }
}

async function sendAdminEmail(env, subject, html) {
  if (!env.ADMIN_NOTIFY_EMAIL) {
    console.error('ADMIN_NOTIFY_EMAIL not configured — skipping email notification');
    return;
  }
  await sendEmail(env, { to: env.ADMIN_NOTIFY_EMAIL, subject, html });
}

function rupee(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

function orderItemsText(items) {
  return (items || [])
    .map(i => `• ${i.product_name} (${i.size}) × ${i.qty}`)
    .join('\n');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── ORDER PLACED — fires right after the D1 insert, whether or not payment
// has been confirmed yet (COD is "placed" immediately; Razorpay orders are
// "placed" but payment_status stays 'created' until verify-payment/webhook) ──
export async function notifyOrderPlaced(env, order) {
  const { orderId, customerName, phone, total, paymentMethod, items } = order;
  const methodLabel = paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online (awaiting payment)';

  const telegramText =
    `🆕 <b>New Order #${orderId}</b>\n` +
    `${customerName} · ${phone}\n` +
    `${orderItemsText(items)}\n` +
    `Total: ${rupee(total)}\n` +
    `Payment: ${methodLabel}`;

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#7b1120">New Order #${orderId}</h2>
      <p><strong>${escapeHtml(customerName)}</strong> · ${escapeHtml(phone)}</p>
      <p style="white-space:pre-line">${escapeHtml(orderItemsText(items))}</p>
      <p><strong>Total: ${rupee(total)}</strong></p>
      <p>Payment: ${methodLabel}</p>
    </div>`;

  await Promise.allSettled([
    sendTelegramMessage(env, telegramText),
    sendAdminEmail(env, `New Order #${orderId} — ${rupee(total)}`, emailHtml),
  ]);
}

// ── PAYMENT CONFIRMED — fires from whichever of verify-payment.js /
// razorpay-webhook.js lands first (the callers dedupe via the UPDATE's
// WHERE clause, so this only ever runs once per order) ──
export async function notifyPaymentConfirmed(env, order) {
  const { orderId, customerName, total } = order;

  const telegramText =
    `✅ <b>Payment Confirmed — Order #${orderId}</b>\n` +
    `${customerName}\n` +
    `Amount: ${rupee(total)}`;

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#1ebe5b">Payment Confirmed — Order #${orderId}</h2>
      <p><strong>${escapeHtml(customerName)}</strong></p>
      <p><strong>Amount: ${rupee(total)}</strong></p>
    </div>`;

  await Promise.allSettled([
    sendTelegramMessage(env, telegramText),
    sendAdminEmail(env, `✅ Payment confirmed — Order #${orderId}`, emailHtml),
  ]);
}
