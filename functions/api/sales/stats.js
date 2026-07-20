// GET /api/sales/stats?from=&to=   — own totals; manager/admin can pass ?userId= for any salesperson
import { requireRole, forbidden } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireRole(request, env, ['salesperson', 'manager', 'admin']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const from = url.searchParams.get('from') || '1970-01-01';
  const to = url.searchParams.get('to') || '9999-12-31';
  const canViewOthers = ['manager', 'admin'].includes(role);
  const targetUserId = canViewOthers && url.searchParams.get('userId')
    ? Number(url.searchParams.get('userId'))
    : user.id;

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) as report_count, COALESCE(SUM(qty),0) as total_qty, COALESCE(SUM(sale_amount),0) as total_amount
     FROM sales_reports WHERE user_id = ? AND report_date BETWEEN ? AND ?`
  ).bind(targetUserId, from, to).first();

  const byProduct = await env.DB.prepare(
    `SELECT p.name as product_name, SUM(s.qty) as total_qty, SUM(s.sale_amount) as total_amount
     FROM sales_reports s JOIN products p ON p.id = s.product_id
     WHERE s.user_id = ? AND s.report_date BETWEEN ? AND ?
     GROUP BY s.product_id ORDER BY total_amount DESC LIMIT 10`
  ).bind(targetUserId, from, to).all();

  return new Response(JSON.stringify({ totals, byProduct: byProduct.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}