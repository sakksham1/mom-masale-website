// functions/api/auth/google.js
// POST /api/auth/google   { credential, platform? }  — credential is the Google ID token JWT
// Verifies the token via Google's tokeninfo endpoint (no JWKS library needed in
// the Workers runtime), then logs in an existing account (matched by google_id,
// falling back to email — which links a Google identity onto an existing
// password account) or creates a brand new user.

import { setSessionCookie, createSession } from '../_utils/session.js';

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

  const credential = body.credential;
  const platform = (body.platform || 'unknown').trim();
  if (!credential) return jsonError('Missing credential');

  // Verify the token is genuine and meant for this app.
  let payload;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!res.ok) return jsonError('Invalid Google token', 401);
    payload = await res.json();
  } catch {
    return jsonError('Could not verify Google sign-in right now. Please try again.', 502);
  }

  if (payload.aud !== env.GOOGLE_CLIENT_ID) return jsonError('Token was not issued for this app', 401);
  if (payload.email_verified !== 'true') return jsonError('Your Google email is not verified', 401);

  const googleId = payload.sub;
  const email = (payload.email || '').trim().toLowerCase();
  const name = payload.name || email.split('@')[0];

  // 1) Already linked to a Google identity?
  let user = await env.DB.prepare('SELECT id, name, email, phone, role FROM users WHERE google_id = ?').bind(googleId).first();

  // 2) Existing email/password account with the same email — link it.
  if (!user) {
    const existing = await env.DB.prepare('SELECT id, name, email, phone, role FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      await env.DB.prepare('UPDATE users SET google_id = ? WHERE id = ?').bind(googleId, existing.id).run();
      user = existing;
    }
  }

  // 3) Brand new account. role is set explicitly — see signup.js for why.
  if (!user) {
    const result = await env.DB.prepare(
      `INSERT INTO users (name, email, password_hash, password_salt, google_id, role) VALUES (?, ?, '', '', ?, 'customer')`
    ).bind(name, email, googleId).run();
    user = { id: result.meta.last_row_id, name, email, phone: null, role: 'customer' };
  }

  const { token, expiresAt } = await createSession(request, env, user.id, platform);

  return new Response(JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setSessionCookie(token, expiresAt),
    },
  });
}