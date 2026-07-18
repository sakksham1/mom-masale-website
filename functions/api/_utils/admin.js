// functions/api/_utils/admin.js
// Shared guard for every /api/admin/* endpoint. Two-step check:
// 1) is there a valid session at all (getUserFromSession)?
// 2) does that user's row have is_admin = 1 in D1?
// Nothing about "admin-ness" is ever trusted from the client — it's a fresh
// DB read on every request.

import { getUserFromSession } from './session.js';

export async function requireAdmin(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return { user: null, isAdmin: false };

  const row = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.id).first();
  const isAdmin = !!(row && row.is_admin);
  return { user, isAdmin };
}

export async function requireRole(request, env, allowedRoles) {
  const user = await getUserFromSession(request, env);
  if (!user) return { user: null, ok: false };
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(user.id).first();
  const ok = !!(row && allowedRoles.includes(row.role));
  return { user, ok, role: row?.role };
}

export async function logAudit(env, { userId, action, resource, resourceId, diff }) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, resource, resource_id, diff) VALUES (?, ?, ?, ?, ?)`
    ).bind(userId, action, resource, resourceId ?? null, diff ? JSON.stringify(diff) : null).run();
  } catch (err) {
    console.error('audit log write failed:', err.message);
  }
}

export function forbidden(message) {
  return new Response(
    JSON.stringify({ error: message || 'Admin access required' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

export function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
