// functions/api/auth/confirm-email-change.js
// POST /api/auth/confirm-email-change  { otp }
import { getUserFromSession } from '../_utils/session.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
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
  const otp = String(body.otp || '').trim();
  if (!otp) return jsonError('Code is required');

  const row = await env.DB.prepare(
    `SELECT id, otp_hash, attempts, expires_at, new_email FROM password_resets
     WHERE user_id = ? AND used = 0 AND purpose = 'email_change' ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!row) return jsonError('Invalid or expired code', 400);
  if (new Date(row.expires_at) < new Date()) return jsonError('This code has expired. Please request a new one.', 400);
  if (row.attempts >= 5) return jsonError('Too many attempts. Please request a new code.', 429);

  const otpHash = await sha256Hex(otp);
  if (otpHash !== row.otp_hash) {
    await env.DB.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return jsonError('Incorrect code', 400);
  }

  // Re-check uniqueness right before committing — the email could have been
  // claimed by someone else in the window since the request was made.
  const clash = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(row.new_email, user.id).first();
  if (clash) return jsonError('That email is now in use by another account. Please start again with a different email.', 409);

  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(row.id).run();
  await env.DB.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?').bind(row.new_email, user.id).run();

  const updated = await env.DB.prepare(
    'SELECT id, name, email, phone, role, email_verified FROM users WHERE id = ?'
  ).bind(user.id).first();

  return new Response(JSON.stringify({
    user: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role: updated.role, emailVerified: !!updated.email_verified },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}