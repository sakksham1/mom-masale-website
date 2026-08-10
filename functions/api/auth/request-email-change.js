// functions/api/auth/request-email-change.js
// POST /api/auth/request-email-change  { newEmail }
// Sends a 6-digit OTP to the NEW address — nothing on the account changes
// until confirm-email-change.js verifies it. Reuses password_resets with
// purpose='email_change' and the new_email column (see migrations/026).
import { getUserFromSession } from '../_utils/session.js';
import { sendEmail, otpEmailHtml } from '../_utils/email.js';

const OTP_TTL_MINUTES = 10;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
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
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const newEmail = String(body.newEmail || '').trim().toLowerCase();
  if (!isValidEmail(newEmail)) return jsonError('Enter a valid email address');
  if (newEmail === user.email) return jsonError('That is already your current email');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(newEmail).first();
  if (existing) return jsonError('That email is already in use by another account', 409);

  const recent = await env.DB.prepare(
    `SELECT id FROM password_resets WHERE user_id = ? AND purpose = 'email_change' AND created_at >= datetime('now', '-60 seconds')`
  ).bind(user.id).first();
  if (recent) return jsonError('Please wait a moment before requesting another code', 429);

  await env.DB.prepare(`UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0 AND purpose = 'email_change'`).bind(user.id).run();

  const otp = genOtp();
  const otpHash = await sha256Hex(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO password_resets (user_id, otp_hash, expires_at, purpose, new_email) VALUES (?, ?, ?, 'email_change', ?)`
  ).bind(user.id, otpHash, expiresAt, newEmail).run();

  try {
    await sendEmail(env, { to: newEmail, subject: 'Confirm your new Mom Masale email', html: otpEmailHtml(otp) });
  } catch (err) {
    console.error('Email change OTP send failed:', err.message);
    return jsonError('Could not send verification email. Please try again.', 502);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}