// POST /api/sales/reports   { productId, size, qty, saleAmount, customerName?, reportDate?, note? }
// GET  /api/sales/reports?mine=1   — salesperson's own history; manager/admin see all
// Deliberately not linked to orders/order_items — these are offline sales,
// outside the website entirely. No status/approval — pure logging.

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['salesperson']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, size, qty, saleAmount, customerName, note } = body;
  const reportDate = body.reportDate || todayISO();

  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!size) return jsonError('size is required');
  if (!Number.isInteger(qty) || qty <= 0) return jsonError('qty must be a positive integer');
  if (!Number.isFinite(saleAmount) || saleAmount < 0) return jsonError('saleAmount must be a non-negative number');

  const sizeRow = await env.DB.prepare(
    `SELECT id FROM product_sizes WHERE product_id = ? AND size = ?`
  ).bind(productId, size).first();
  if (!sizeRow) return jsonError('Unknown product/size combination', 400);

  const result = await env.DB.prepare(
    `INSERT INTO sales_reports (user_id, product_id, size, qty, sale_amount, customer_name, report_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, productId, size, qty, saleAmount, customerName || null, reportDate, note || null).run();

  return new Response(JSON.stringify({ ok: true, reportId: result.meta.last_row_id }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireRole(request, env, ['salesperson', 'manager', 'admin']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const scopeToSelf = url.searchParams.get('mine') === '1' || !['manager', 'admin'].includes(role);

  let query = `SELECT s.id, s.user_id, u.name as salesperson_name, s.product_id, p.name as product_name,
                      s.size, s.qty, s.sale_amount, s.customer_name, s.report_date, s.created_at
               FROM sales_reports s
               JOIN products p ON p.id = s.product_id
               JOIN users u ON u.id = s.user_id
               WHERE 1=1`;
  const binds = [];
  if (scopeToSelf) { query += ' AND s.user_id = ?'; binds.push(user.id); }
  query += ' ORDER BY s.report_date DESC, s.created_at DESC LIMIT 300';

  const result = await env.DB.prepare(query).bind(...binds).all();
  return new Response(JSON.stringify({ reports: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}