// functions/api/auth/send-login-otp.js
// POST /api/auth/send-login-otp  { email } — always returns a generic response.
import { sendEmail, otpEmailHtml } from '../_utils/email.js';

const OTP_TTL_MINUTES = 10;

function genOtp() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body; try { body = await request.json(); } catch { body = {}; }
  const email = (body.email || '').trim().toLowerCase();

  const generic = new Response(
    JSON.stringify({ ok: true, message: 'If an account exists for this email, a login code has been sent.' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
  if (!email) return generic;

  const user = await env.DB.prepare('SELECT id, name, email FROM users WHERE email = ?').bind(email).first();
  if (!user) return generic;

  // Reuse password_resets as a generic "OTP" table — invalidate any pending codes first.
  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').bind(user.id).run();

  const otp = genOtp();
  const otpHash = await sha256Hex(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await env.DB.prepare('INSERT INTO password_resets (user_id, otp_hash, expires_at) VALUES (?, ?, ?)')
    .bind(user.id, otpHash, expiresAt).run();

  try {
    await sendEmail(env, { to: user.email, subject: 'Your Mom Masale login code', html: otpEmailHtml(otp) });
  } catch (err) {
    console.error('Login OTP email send failed:', err.message);
  }

  return generic;
}