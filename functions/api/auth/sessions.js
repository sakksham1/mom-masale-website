// GET    /api/auth/sessions          — list the logged-in user's own active sessions
// DELETE /api/auth/sessions  { sessionId }  — revoke one of the user's own sessions
//
// Every user manages their own sessions here regardless of role — this is
// not an admin tool. See manager/staff-logins.js for the staff-only view.
//
// `sessionId` is the session's SQLite rowid, NOT the raw token — we never
// hand the actual session token back to the client for a session other than
// the one it's currently authenticated with.

import { getUserFromSession, getSessionToken } from '../_utils/session.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  const currentToken = getSessionToken(request);
  const currentRow = currentToken
    ? await env.DB.prepare(`SELECT rowid as rid FROM sessions WHERE id = ?`).bind(currentToken).first()
    : null;
  const currentRowId = currentRow?.rid ?? null;

  const result = await env.DB.prepare(
    `SELECT rowid as id, platform, user_agent, ip_address, created_at, last_seen_at, expires_at
     FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`
  ).bind(user.id).all();

  const sessions = (result.results || []).map(s => ({
    id: s.id,
    platform: s.platform,
    userAgent: s.user_agent,
    ipAddress: s.ip_address,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    expiresAt: s.expires_at,
    isCurrent: s.id === currentRowId,
  }));

  return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const sessionId = body.sessionId;
  if (!Number.isInteger(sessionId)) return jsonError('sessionId is required');

  const result = await env.DB.prepare(
    `DELETE FROM sessions WHERE rowid = ? AND user_id = ?`
  ).bind(sessionId, user.id).run();

  if (result.meta.changes === 0) return jsonError('Session not found', 404);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}