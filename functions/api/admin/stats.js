// functions/api/admin/stats.js
// GET /api/admin/stats — headline numbers for the dashboard's Overview tab.
// All revenue figures only count payment_status = 'paid' orders, so a pending
// or failed Razorpay attempt never inflates the numbers.

import { requireAdmin, forbidden } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const overall = await env.DB.prepare(
    `SELECT COALESCE(SUM(total), 0) as total_revenue, COUNT(*) as paid_orders
     FROM orders WHERE payment_status = 'paid'`
  ).first();

  const today = await env.DB.prepare(
    `SELECT COALESCE(SUM(total), 0) as today_revenue, COUNT(*) as today_orders
     FROM orders WHERE payment_status = 'paid' AND date(created_at) = date('now')`
  ).first();

  const month = await env.DB.prepare(
    `SELECT COALESCE(SUM(total), 0) as month_revenue, COUNT(*) as month_orders
     FROM orders WHERE payment_status = 'paid' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
  ).first();

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) as pending_count FROM orders WHERE status IN ('placed','packed','shipped')`
  ).first();

  const customers = await env.DB.prepare(`SELECT COUNT(*) as total_customers FROM users`).first();

  const topProducts = await env.DB.prepare(
    `SELECT oi.product_name, oi.product_slug, SUM(oi.qty) as total_qty, SUM(oi.qty * oi.unit_price) as total_revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'paid'
     GROUP BY oi.product_slug
     ORDER BY total_qty DESC
     LIMIT 5`
  ).all();

  const recentOrders = await env.DB.prepare(
    `SELECT id, customer_name, total, status, payment_status, created_at
     FROM orders ORDER BY created_at DESC LIMIT 8`
  ).all();

  return new Response(JSON.stringify({
    totalRevenue: overall.total_revenue,
    paidOrders: overall.paid_orders,
    todayRevenue: today.today_revenue,
    todayOrders: today.today_orders,
    monthRevenue: month.month_revenue,
    monthOrders: month.month_orders,
    pendingOrders: pending.pending_count,
    totalCustomers: customers.total_customers,
    topProducts: topProducts.results || [],
    recentOrders: recentOrders.results || [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
