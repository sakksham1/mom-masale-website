// functions/api/admin/orders.js
// GET   /api/admin/orders?status=&payment_status=   — list orders (newest first), with items
// PATCH /api/admin/orders  { orderId, status?, payment_status? }  — update one order

import { requireAdmin, requireRole, forbidden, jsonError } from '../_utils/admin.js';

const VALID_STATUS = ['placed', 'packed', 'shipped', 'delivered', 'cancelled'];
const VALID_PAYMENT_STATUS = ['created', 'paid', 'failed', 'cod'];

export async function onRequestGet(context) {
  const { request, env } = context;
  // View access now includes manager — PATCH below stays admin-only.
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const paymentFilter = url.searchParams.get('payment_status');

  let query = `SELECT id, user_id, customer_name, phone, email, address, city, pincode,
                      subtotal, shipping_fee, total, status, payment_status,
                      razorpay_order_id, razorpay_payment_id, created_at, updated_at
               FROM orders WHERE 1=1`;
  const binds = [];
  if (statusFilter) { query += ' AND status = ?'; binds.push(statusFilter); }
  if (paymentFilter) { query += ' AND payment_status = ?'; binds.push(paymentFilter); }
  query += ' ORDER BY created_at DESC LIMIT 300';

  const ordersResult = await env.DB.prepare(query).bind(...binds).all();
  const orders = ordersResult.results || [];

  for (const order of orders) {
    const itemsResult = await env.DB.prepare(
      `SELECT product_slug, product_name, size, qty, unit_price FROM order_items WHERE order_id = ?`
    ).bind(order.id).all();
    order.items = itemsResult.results || [];
  }

  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env); // unchanged — admin-only
  if (!isAdmin) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { orderId, status, payment_status } = body;
  if (!orderId) return jsonError('orderId is required');
  if (!status && !payment_status) return jsonError('Provide status and/or payment_status to update');
  if (status && !VALID_STATUS.includes(status)) return jsonError(`status must be one of: ${VALID_STATUS.join(', ')}`);
  if (payment_status && !VALID_PAYMENT_STATUS.includes(payment_status)) {
    return jsonError(`payment_status must be one of: ${VALID_PAYMENT_STATUS.join(', ')}`);
  }

  const existing = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first();
  if (!existing) return jsonError('Order not found', 404);

  const sets = [];
  const binds = [];
  if (status) { sets.push('status = ?'); binds.push(status); }
  if (payment_status) { sets.push('payment_status = ?'); binds.push(payment_status); }
  sets.push(`updated_at = datetime('now')`);
  binds.push(orderId);

  await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
