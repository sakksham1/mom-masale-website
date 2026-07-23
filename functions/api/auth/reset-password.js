// POST /api/auth/reset-password  { email, resetToken, newPassword }
import { hashPassword } from '../_utils/crypto.js';
import { validatePassword } from '../_utils/password.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const email = (body.email || '').trim().toLowerCase();
  const resetToken = (body.resetToken || '').trim();
  const newPassword = body.newPassword || '';
  if (!email || !resetToken) return jsonError('Missing reset token');

  const { valid, errors } = validatePassword(newPassword);
  if (!valid) return jsonError(`Password requirements not met: ${errors.join(', ')}`);

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) return jsonError('Invalid or expired reset link', 400);

  const row = await env.DB.prepare(
    `SELECT id, expires_at FROM password_resets WHERE user_id = ? AND reset_token = ? AND verified = 1 AND used = 0`
  ).bind(user.id, resetToken).first();

  if (!row) return jsonError('Invalid or expired reset link', 400);
  if (new Date(row.expires_at) < new Date()) return jsonError('This reset link has expired. Please start again.', 400);

  const { hash, salt, iterations } = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?').bind(hash, salt, iterations, user.id).run();
  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(row.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run(); // log out everywhere

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}