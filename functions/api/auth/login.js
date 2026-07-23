// functions/api/auth/login.js
// POST /api/auth/login
// Body: { email, password, platform?, website? }

import { verifyPassword, hashPassword, needsRehash } from '../_utils/crypto.js';
import { setSessionCookie, createSession } from '../_utils/session.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function recordAttempt(env, email, success, ipAddress) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (email, success, ip_address) VALUES (?, ?, ?)`
  ).bind(email, success ? 1 : 0, ipAddress || null).run();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  // Honeypot — real users never fill this in; bots that autofill every field do.
  if (body.website) {
    return jsonError('Incorrect email or password', 401);
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const platform = (body.platform || 'unknown').trim();
  const ipAddress = request.headers.get('CF-Connecting-IP') || null;

  if (!email || !password) return jsonError('Email and password are required');

  const lockoutCheck = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM login_attempts
     WHERE email = ? AND success = 0 AND created_at >= datetime('now', '-${LOCKOUT_WINDOW_MINUTES} minutes')`
  ).bind(email).first();
  if (lockoutCheck.c >= MAX_FAILED_ATTEMPTS) {
    return jsonError('Too many failed login attempts. Please try again in 15 minutes.', 429);
  }

  const user = await env.DB.prepare(
    'SELECT id, name, email, phone, role, password_hash, password_salt, password_iterations FROM users WHERE email = ?'
  ).bind(email).first();

  // Deliberately generic — don't reveal whether the email exists.
  if (!user) {
    await recordAttempt(env, email, false, ipAddress);
    return jsonError('Incorrect email or password', 401);
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt, user.password_iterations);
  if (!valid) {
    await recordAttempt(env, email, false, ipAddress);
    return jsonError('Incorrect email or password', 401);
  }

  await recordAttempt(env, email, true, ipAddress);

  // Opportunistic upgrade — accounts created before the PBKDF2 iteration bump
  // get re-hashed at the new standard the next time they log in successfully.
  if (needsRehash(user.password_iterations)) {
    context.waitUntil((async () => {
      const { hash, salt, iterations } = await hashPassword(password);
      await env.DB.prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?'
      ).bind(hash, salt, iterations, user.id).run();
    })());
  }

  const { token, expiresAt } = await createSession(request, env, user.id, platform);

  return new Response(
    JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(token, expiresAt),
      },
    }
  );
}