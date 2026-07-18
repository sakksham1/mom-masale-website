// POST /api/auth/verify-reset-otp  { email, otp } → { resetToken }
const MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MINUTES = 10;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function genToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const email = (body.email || '').trim().toLowerCase();
  const otp = (body.otp || '').trim();
  if (!email || !otp) return jsonError('Email and OTP are required');

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) return jsonError('Invalid or expired code', 400);

  const row = await env.DB.prepare(
    `SELECT id, otp_hash, attempts, expires_at FROM password_resets
     WHERE user_id = ? AND used = 0 AND purpose = 'reset' ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!row) return jsonError('Invalid or expired code', 400);
  if (new Date(row.expires_at) < new Date()) return jsonError('This code has expired. Please request a new one.', 400);
  if (row.attempts >= MAX_ATTEMPTS) return jsonError('Too many attempts. Please request a new code.', 429);

  const otpHash = await sha256Hex(otp);
  if (otpHash !== row.otp_hash) {
    await env.DB.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return jsonError('Incorrect code', 400);
  }

  const resetToken = genToken();
  const newExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  await env.DB.prepare('UPDATE password_resets SET verified = 1, reset_token = ?, expires_at = ? WHERE id = ?')
    .bind(resetToken, newExpiry, row.id).run();

  return new Response(JSON.stringify({ ok: true, resetToken }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}