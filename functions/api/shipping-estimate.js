// functions/api/shipping-estimate.js
// POST /api/shipping-estimate  { pincode, subtotal }
// Powers the "Check Shipping" button — looks up the real area name for the
// pincode via India Post's public API, and separately resolves our internal
// zone (local/up/national) purely to calculate the fee. Only the area name
// is ever shown to the customer — zone labels stay internal.

import { resolveShipping } from './_utils/shipping.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Returns a human area string like "Shuklaganj, Unnao, Uttar Pradesh", or
// null if the lookup fails/pincode isn't found — callers fall back gracefully.
async function lookupArea(pincode) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.[0];
    if (result?.Status !== 'Success' || !result.PostOffice?.length) return null;

    const office = result.PostOffice[0];
    const parts = [office.Name, office.District, office.State].filter(Boolean);
    return parts.join(', ');
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const pincode = String(body.pincode || '').trim();
  const subtotal = Number(body.subtotal);

  if (!/^\d{6}$/.test(pincode)) return jsonError('Enter a valid 6-digit pincode');
  if (!Number.isFinite(subtotal) || subtotal < 0) return jsonError('Invalid subtotal');

  let settings;
  try {
    const settingsUrl = new URL('/data/settings.json', request.url);
    const settingsRes = await fetch(settingsUrl.toString());
    if (!settingsRes.ok) throw new Error('fetch failed');
    settings = await settingsRes.json();
  } catch {
    return jsonError('Could not load shipping settings right now. Please try again.', 502);
  }

  const [{ fee, feeType, label }, area] = await Promise.all([
    Promise.resolve(resolveShipping(pincode, subtotal, settings)),
    lookupArea(pincode),
  ]);

  return new Response(JSON.stringify({
    area: area || 'your area',
    fee,
    feeType,
    label,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}