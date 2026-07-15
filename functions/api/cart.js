// functions/api/cart.js
// GET /api/cart — returns the logged-in user's cart ({ items, loggedIn }).
//   Guests get an empty cart + loggedIn:false, never a 401 — the frontend
//   uses that flag to decide whether "Add to Cart" is allowed at all.
// PUT /api/cart  { items: [{name,size,qty,price,image}] }
//   Replaces the user's entire cart. The client always sends the full cart
//   on every change (matches the old localStorage write pattern), so a
//   delete-all-then-reinsert is simplest and avoids partial-update races.

import { getUserFromSession } from './_utils/session.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);

  if (!user) {
    return new Response(JSON.stringify({ items: [], loggedIn: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await env.DB.prepare(
    `SELECT product_name as name, size, qty, price, image
     FROM cart_items WHERE user_id = ? ORDER BY id ASC`
  ).bind(user.id).all();

  return new Response(JSON.stringify({ items: result.results || [], loggedIn: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) return jsonError('items array is required');

  for (const item of items) {
    if (!item || !item.name || !item.size || !Number.isInteger(item.qty) || item.qty < 1) {
      return jsonError('Each cart item needs a name, size, and positive integer qty');
    }
  }

  await env.DB.prepare('DELETE FROM cart_items WHERE user_id = ?').bind(user.id).run();

  for (const item of items) {
    await env.DB.prepare(
      `INSERT INTO cart_items (user_id, product_name, size, qty, price, image)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      String(item.name),
      String(item.size),
      item.qty,
      Number.isFinite(item.price) ? item.price : 0,
      item.image || null
    ).run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}