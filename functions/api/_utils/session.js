// functions/api/_utils/session.js
// Cookie-based sessions backed by the D1 `sessions` table (not JWTs) — a session
// is just a row, so "log out everywhere" is a DELETE, and there's no token to
// forge if the app is compromised elsewhere.

const SESSION_COOKIE = 'mm_session';
const SESSION_DURATION_DAYS = 30;

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
            sessions.expires_at as expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`
  ).bind(token).first();

  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    // Expired — clean it up so it doesn't linger in the table.
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
    return null;
  }

  return { id: row.id, name: row.name, email: row.email, phone: row.phone };
}
