// functions/api/_utils/session.js
// Cookie-based sessions backed by the D1 `sessions` table (not JWTs) — a session
// is just a row, so "log out everywhere" is a DELETE, and there's no token to
// forge if the app is compromised elsewhere.
import { generateSessionToken } from './crypto.js';

const SESSION_COOKIE = 'mm_session';
const SESSION_DURATION_DAYS = 30;

// Creates a session row + a permanent login_history row (the latter never
// gets deleted on logout, which is what makes "recent staff logins" work).
export async function createSession(request, env, userId, platform) {
  const token = generateSessionToken();
  const expiresAt = newExpiry();
  const userAgent = request.headers.get('User-Agent') || null;
  const ipAddress = request.headers.get('CF-Connecting-IP') || null;

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at, platform, user_agent, ip_address)
     VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?)`
  ).bind(token, userId, expiresAt, platform || null, userAgent, ipAddress).run();

  await env.DB.prepare(
    `INSERT INTO login_history (user_id, platform, user_agent, ip_address) VALUES (?, ?, ?, ?)`
  ).bind(userId, platform || null, userAgent, ipAddress).run();

  return { token, expiresAt };
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

export function getSessionToken(request) {
  return parseCookies(request)[SESSION_COOKIE] || null;
}

export function newExpiry() {
  return new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function setSessionCookie(token, expiresAtIso) {
  const expires = new Date(expiresAtIso).toUTCString();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// Looks up the session token from the request cookie, validates it against D1,
// and returns the user record — or null if there's no valid session.
export async function getUserFromSession(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;

   const row = await env.DB.prepare(
    `SELECT users.id as id, users.name as name, users.email as email, users.phone as phone,
            users.role as role, users.email_verified as email_verified,
            sessions.expires_at as expires_at, sessions.last_seen_at as last_seen_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`
  ).bind(token).first();

  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
    return null;
  }

  // Throttle — only touch last_seen_at if it's stale by 60s+, so a burst of
  // requests from the same device doesn't turn into a write per request.
  const staleMs = Date.now() - new Date(row.last_seen_at || 0).getTime();
  if (staleMs > 60_000) {
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`).bind(token).run();
  }

  return { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role, emailVerified: !!row.email_verified }
}
