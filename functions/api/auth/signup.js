// functions/api/auth/signup.js
// POST /api/auth/signup
// Body: { name, email, password, phone, platform? }

import { hashPassword } from '../_utils/crypto.js';
import { validatePassword } from '../_utils/password.js';
import { setSessionCookie, createSession } from '../_utils/session.js';
import { sendEmail, otpEmailHtml } from '../_utils/email.js';
import { createNotification } from '../_utils/notify.js';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Same shape checkout.js already requires for customer phones — keeps the
// two entry points consistent instead of inventing a second phone format.
function isValidPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const APP_PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux'];

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  // Honeypot — real users never fill this in.
  if (body.website) {
    return jsonError('Something went wrong. Please try again.', 400);
  }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const phone = (body.phone || '').trim();
  const platform = (body.platform || 'unknown').trim();

  if (!name) return jsonError('Name is required');
  if (!isValidEmail(email)) return jsonError('A valid email is required');
  if (!phone) return jsonError('Phone number is required');
  if (!isValidPhone(phone)) return jsonError('Enter a valid 10-digit phone number');

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) return jsonError(`Password requirements not met: ${passwordCheck.errors.join(', ')}`);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonError('An account with this email already exists', 409);

  const { hash, salt, iterations } = await hashPassword(password);

  const result = await env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, password_salt, password_iterations, phone, role, signup_platform)
     VALUES (?, ?, ?, ?, ?, ?, 'customer', ?)`
  ).bind(name, email, hash, salt, iterations, phone, platform).run();

  const userId = result.meta.last_row_id;

  const { token, expiresAt } = await createSession(request, env, userId, platform);

  try {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    const otp = String(n).padStart(6, '0');
    const otpBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(otp));
    const otpHash = [...new Uint8Array(otpBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAtOtp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO password_resets (user_id, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?)')
      .bind(userId, otpHash, expiresAtOtp, 'verify').run();
    await sendEmail(env, { to: email, subject: 'Verify your Mom Masale email', html: otpEmailHtml(otp) });
  } catch (err) {
    console.error('Verification email send failed:', err.message);
  }

  if (APP_PLATFORMS.includes(platform)) {
    context.waitUntil(createNotification(env, {
      type: 'app_signup',
      title: 'New app signup awaiting a role',
      body: `${name} (${email}) signed up from the ${platform} app — assign them a role to let them in.`,
      referenceType: 'user',
      referenceId: userId,
    }));
  }

  return new Response(JSON.stringify({ user: { id: userId, name, email, phone, role: 'customer', emailVerified: false } }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setSessionCookie(token, expiresAt),
    },
  });
}