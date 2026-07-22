// functions/api/notifications/register-token.js
// POST   /api/notifications/register-token   { token, platform }
// DELETE /api/notifications/register-token   { token }   — call on logout
//
// Stores/removes the FCM device registration token for the logged-in user.
// Scoped to admin/manager for now, since those are the only roles that see
// the in-app bell today (see admin/notifications.js) — extend the roles
// array here (and in fcm.js callers) if other roles get notifications later.

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const token = (body.token || '').trim();
  const platform = (body.platform || 'unknown').trim();
  if (!token) return jsonError('token is required');

  await env.DB.prepare(
    `INSERT INTO push_tokens (user_id, token, platform, created_at, last_seen_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id, platform = excluded.platform, last_seen_at = datetime('now')`
  ).bind(user.id, token, platform).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const token = (body.token || '').trim();
  if (!token) return jsonError('token is required');

  await env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}