// functions/api/auth/send-verify-otp.js
// POST /api/auth/send-verify-otp — sends (or resends) the email-verification
// code for the logged-in session. No email in the body — always targets
// whoever the session cookie belongs to, so there's no enumeration surface.

import { getUserFromSession } from '../_utils/session.js';
import { sendEmail, otpEmailHtml } from '../_utils/email.js';

const OTP_TTL_MINUTES = 10;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
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

  if (user.emailVerified) {
    return new Response(JSON.stringify({ ok: true, alreadyVerified: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cooldown — silently no-op if a code was requested in the last 60s
  // (covers the automatic send that fires when the verify gate first loads,
  // right after signup.js already sent one of its own).
  const recent = await env.DB.prepare(
    `SELECT id FROM password_resets WHERE user_id = ? AND purpose = 'verify' AND created_at >= datetime('now', '-60 seconds')`
  ).bind(user.id).first();
  if (recent) {
    return new Response(JSON.stringify({ ok: true, cooldown: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0 AND purpose = ?').bind(user.id, 'verify').run();

  const otp = genOtp();
  const otpHash = await sha256Hex(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await env.DB.prepare('INSERT INTO password_resets (user_id, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?)')
    .bind(user.id, otpHash, expiresAt, 'verify').run();

  try {
    await sendEmail(env, { to: user.email, subject: 'Verify your Mom Masale email', html: otpEmailHtml(otp) });
  } catch (err) {
    console.error('Verification email send failed:', err.message);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}