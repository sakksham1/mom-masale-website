// functions/api/auth/verify-login-otp.js
// POST /api/auth/verify-login-otp  { email, otp, platform? } — on success, logs the user in directly.

import { setSessionCookie, createSession } from '../_utils/session.js';

const MAX_ATTEMPTS = 5;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const email = (body.email || '').trim().toLowerCase();
  const otp = (body.otp || '').trim();
  const platform = (body.platform || 'unknown').trim();
  if (!email || !otp) return jsonError('Email and code are required');

  const user = await env.DB.prepare('SELECT id, name, email, phone, role, email_verified FROM users WHERE email = ?').bind(email).first();
  if (!user) return jsonError('Invalid or expired code', 400);

  const row = await env.DB.prepare(
    `SELECT id, otp_hash, attempts, expires_at FROM password_resets
     WHERE user_id = ? AND used = 0 AND purpose = 'login' ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!row) return jsonError('Invalid or expired code', 400);
  if (new Date(row.expires_at) < new Date()) return jsonError('This code has expired. Please request a new one.', 400);
  if (row.attempts >= MAX_ATTEMPTS) return jsonError('Too many attempts. Please request a new code.', 429);

  const otpHash = await sha256Hex(otp);
  if (otpHash !== row.otp_hash) {
    await env.DB.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return jsonError('Incorrect code', 400);
  }

  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(row.id).run();

  const { token, expiresAt } = await createSession(request, env, user.id, platform);

  return new Response(JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, emailVerified: !!user.email_verified } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token, expiresAt) },
  });
}