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

  // D1 doesn't do nested joins-to-array, so items are fetched per order.
  // Fine at this scale (a customer has a handful of orders, not thousands).
  for (const order of orders) {
    const itemsResult = await env.DB.prepare(
      `SELECT product_slug, product_name, size, qty, unit_price
       FROM order_items WHERE order_id = ?`
    ).bind(order.id).all();
    order.items = itemsResult.results || [];
  }

  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
