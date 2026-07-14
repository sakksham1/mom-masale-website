// functions/api/_utils/razorpay.js
// Server-side Razorpay helpers. Uses fetch (Razorpay's REST API directly)
// rather than their Node SDK, since the SDK assumes a Node runtime that
// Cloudflare Workers doesn't provide.

async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Creates a Razorpay Order (server-side) for the given amount (in paise).
// Throws on failure — caller is responsible for catching and responding.
export async function createRazorpayOrder(env, amountInPaise, receipt) {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      payment_capture: 1,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.description || 'Razorpay order creation failed');
  }
  return data; // { id: 'order_xxx', amount, currency, ... }
}

// Verifies the signature Razorpay's Checkout.js hands back after a successful
// payment. This is the client-side confirmation path — the webhook (below) is
// the more trustworthy server-to-server backup for the same event.
export async function verifyPaymentSignature(env, razorpayOrderId, razorpayPaymentId, signature) {
  const expected = await hmacSha256Hex(`${razorpayOrderId}|${razorpayPaymentId}`, env.RAZORPAY_KEY_SECRET);
  return expected === signature;
}

// Verifies the X-Razorpay-Signature header on incoming webhook events,
// using the separate webhook secret (set when you configure the webhook URL
// in the Razorpay dashboard — not the same as your API key secret).
export async function verifyWebhookSignature(env, rawBody, signatureHeader) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = await hmacSha256Hex(rawBody, env.RAZORPAY_WEBHOOK_SECRET);
  return expected === signatureHeader;
}
