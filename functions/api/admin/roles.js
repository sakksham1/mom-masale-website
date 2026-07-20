// PATCH /api/admin/roles   { userId, role }
// Admin only, per your plan — this is the one action that stays outside
// the manager-approval loop entirely, since role changes are how approval
// authority itself gets granted.

import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';

const ASSIGNABLE_ROLES = ['admin', 'manager', 'warehouser', 'packaging', 'salesperson', 'customer'];

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { userId, role } = body;
  if (!Number.isInteger(userId)) return jsonError('userId is required');
  if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
  if (userId === user.id && role !== 'admin') return jsonError('You cannot demote your own account');

  const target = await env.DB.prepare('SELECT id, name, role FROM users WHERE id = ?').bind(userId).first();
  if (!target) return jsonError('User not found', 404);
  if (target.role === role) return jsonError(`User is already ${role}`, 409);

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run();
  await logAudit(env, {
    userId: user.id, action: 'role_change', resource: 'user', resourceId: userId,
    diff: { from: target.role, to: role, targetName: target.name },
  });

  // No session invalidation needed — requireRole always reads role fresh
  // from D1 on every request, so this takes effect on the target's very
  // next API call.

  return new Response(JSON.stringify({ ok: true, userId, role }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  const result = await env.DB.prepare(
    `SELECT id, name, email, phone, role, created_at FROM users ORDER BY role, name`
  ).all();
  return new Response(JSON.stringify({ users: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}