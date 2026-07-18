// functions/api/auth/login.js
// POST /api/auth/login
// Body: { email, password }

import { verifyPassword, generateSessionToken } from '../_utils/crypto.js';
import { setSessionCookie, newExpiry } from '../_utils/session.js';

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

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) return jsonError('Email and password are required');

  const user = await env.DB.prepare(
    'SELECT id, name, email, phone, role, password_hash, password_salt FROM users WHERE email = ?'
  ).bind(email).first();

  // Deliberately generic — don't reveal whether the email exists.
  if (!user) return jsonError('Incorrect email or password', 401);

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) return jsonError('Incorrect email or password', 401);

  const token = generateSessionToken();
  const expiresAt = newExpiry();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, user.id, expiresAt).run();

  return new Response(
    SON.stringify({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(token, expiresAt),
      },
    }
  );
}
