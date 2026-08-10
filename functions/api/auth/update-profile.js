// functions/api/auth/update-profile.js
// PATCH /api/auth/update-profile  { name?, phone? }
import { getUserFromSession } from '../_utils/session.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
function isValidPhone(phone) { return /^[6-9]\d{9}$/.test(phone); }

export async function onRequestPatch(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const sets = [];
  const binds = [];

  if ('name' in body) {
    const name = String(body.name || '').trim();
    if (!name) return jsonError('Name cannot be empty');
    if (name.length > 100) return jsonError('Name is too long');
    sets.push('name = ?'); binds.push(name);
  }
  if ('phone' in body) {
    const phone = String(body.phone || '').trim();
    if (!isValidPhone(phone)) return jsonError('Enter a valid 10-digit phone number');
    sets.push('phone = ?'); binds.push(phone);
  }

  if (!sets.length) return jsonError('No changes provided');

  binds.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await env.DB.prepare(
    'SELECT id, name, email, phone, role, email_verified FROM users WHERE id = ?'
  ).bind(user.id).first();

  return new Response(JSON.stringify({
    user: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role: updated.role, emailVerified: !!updated.email_verified },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}