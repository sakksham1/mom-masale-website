// GET /api/manager/staff-logins?limit=50
// admin or manager only. Recent login history for staff accounts (every
// role except 'customer'). Deliberately reads login_history, not sessions,
// so a login still shows up here even after that device has logged out.

import { requireRole, forbidden } from '../_utils/admin.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));

  const result = await env.DB.prepare(
    `SELECT lh.id, lh.user_id, u.name as user_name, u.role as user_role,
            lh.platform, lh.user_agent, lh.ip_address, lh.created_at
     FROM login_history lh
     JOIN users u ON u.id = lh.user_id
     WHERE u.role != 'customer'
     ORDER BY lh.created_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return new Response(JSON.stringify({ logins: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}