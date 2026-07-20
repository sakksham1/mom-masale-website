// functions/api/_utils/admin.js
// Shared guard for every /api/admin/* endpoint.
//
// Admin-ness lives ONLY on users.role ('admin' | 'staff' | 'packer' |
// 'accountant' | 'customer'). getUserFromSession() already does a fresh
// JOIN against users on every request (see session.js), so role here is
// never stale/cached — no second DB read needed.

import { getUserFromSession } from './session.js';

export async function requireAdmin(request, env) {
  const user = await getUserFromSession(request, env);
  if (!user) return { user: null, isAdmin: false };
  return { user, isAdmin: user.role === 'admin' };
}

// Generic role guard, always a fresh DB read — never trust session/cookie
// claims about role. A demote takes effect on the very next request.
export async function requireRole(request, env, allowedRoles) {
  const user = await getUserFromSession(request, env);
  if (!user) return { user: null, ok: false, role: null };
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(user.id).first();
  const role = row?.role || null;
  return { user, ok: !!(role && allowedRoles.includes(role)), role };
}

// Manager or admin — the two roles allowed to decide on pending approvals.
export async function requireApprover(request, env) {
  return requireRole(request, env, ['admin', 'manager']);
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
