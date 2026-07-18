// functions/api/auth/signup.js
// POST /api/auth/signup
// Body: { name, email, password, phone? }

import { hashPassword, generateSessionToken } from '../_utils/crypto.js';
import { validatePassword } from '../_utils/password.js';
import { setSessionCookie, newExpiry } from '../_utils/session.js';
import { sendEmail, otpEmailHtml } from '../_utils/email.js';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const phone = (body.phone || '').trim();

  if (!name) return jsonError('Name is required');
  if (!isValidEmail(email)) return jsonError('A valid email is required');
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) return jsonError(`Password requirements not met: ${passwordCheck.errors.join(', ')}`);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonError('An account with this email already exists', 409);

  const { hash, salt } = await hashPassword(password);

  const result = await env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, password_salt, phone) VALUES (?, ?, ?, ?, ?)`
  ).bind(name, email, hash, salt, phone || null).run();

  const userId = result.meta.last_row_id;

  const token = generateSessionToken();
  const expiresAt = newExpiry();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expiresAt).run();

  // Fire-and-forget: verification is informational for now, doesn't block login.
  try {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    const otp = String(n).padStart(6, '0');
    const otpBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(otp));
    const otpHash = [...new Uint8Array(otpBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO password_resets (user_id, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?)')
      .bind(userId, otpHash, expiresAt, 'verify').run();
    await sendEmail(env, { to: email, subject: 'Verify your Mom Masale email', html: otpEmailHtml(otp) });
  } catch (err) {
    console.error('Verification email send failed:', err.message);
  }

  return new Response(JSON.stringify({ id: userId, name, email, phone: phone || null }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setSessionCookie(token, expiresAt),
    },
  });
}
