// functions/api/admin/customers.js
// GET /api/admin/customers — every registered user, with order count + lifetime spend.
// NOTE: this only lists accounts that signed up (users table). Guest checkouts
// (user_id NULL on the order) are counted in stats.js revenue totals but won't
// show up here as a "customer" since there's no account to list them under.

import { requireAdmin, forbidden } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const result = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
            COUNT(o.id) as order_count,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END), 0) as lifetime_spend
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  ).all();

  return new Response(JSON.stringify({ customers: result.results || [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
