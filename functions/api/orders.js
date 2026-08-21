// functions/api/orders.js
// GET /api/orders — returns the logged-in user's order history, newest first,
// each order with its line items attached.
//
// NOTE: order *creation* (checkout + Razorpay) isn't in this file yet — that's
// the next stage. This is read-only, for the "My Orders" account page.

import { getUserFromSession } from './_utils/session.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Login required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ordersResult = await env.DB.prepare(
    `SELECT id, subtotal, shipping_fee, total, status, payment_status, created_at
     FROM orders
     WHERE user_id = ?
     ORDER BY created_at DESC`
  ).bind(user.id).all();

  const orders = ordersResult.results || [];

  // Batched item fetch — one query for every order instead of the old
  // per-order loop. Was fine at "a handful of orders" scale but matches
  // the same fix applied to admin/orders.js, and it's free.
  if (orders.length) {
    const ids = orders.map(o => o.id);
    const placeholders = ids.map(() => '?').join(',');
    const itemsResult = await env.DB.prepare(
      `SELECT order_id, product_slug, product_name, size, qty, unit_price
       FROM order_items WHERE order_id IN (${placeholders})`
    ).bind(...ids).all();
    const itemsByOrder = {};
    for (const row of itemsResult.results || []) {
      (itemsByOrder[row.order_id] ||= []).push(row);
    }
    orders.forEach(o => { o.items = itemsByOrder[o.id] || []; });
  }

  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
