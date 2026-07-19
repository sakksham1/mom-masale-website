// functions/api/checkout.js
// POST /api/checkout
// Body: { customer: {name, phone, email?, address, city, pincode},
//         items: [{name, size, qty}], paymentMethod: 'razorpay' | 'cod' }
//
// CRITICAL: prices are never trusted from the client. This now reprices
// against D1 directly (products/product_sizes — see migrations/0002) instead
// of self-fetching the deployed data/products.json. Same trust model as
// before (never trust the client), just a more direct source: D1 is
// authoritative the instant an admin saves a change, with no dependency on
// a GitHub commit + Pages rebuild finishing first.
//
// Stock is decremented here too. If any line item is out of stock, every
// decrement already applied for this order is rolled back and the order
// itself is deleted (order_items cascades) before returning the error —
// D1 doesn't give Workers a multi-statement app-level transaction here, so
// this is a compensating-action rollback rather than a real ROLLBACK.

import { getUserFromSession } from './_utils/session.js';
import { createRazorpayOrder } from './_utils/razorpay.js';
import { notifyOrderPlaced } from './_utils/notify.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function restoreStock(env, items, orderId, note) {
  for (const item of items) {
    await env.DB.prepare(
      `UPDATE product_sizes SET stock_qty = stock_qty + ? WHERE product_id = ? AND size = ?`
    ).bind(item.qty, item.productId, item.size).run();
    await env.DB.prepare(
      `INSERT INTO inventory_movements (product_id, size, change_qty, reason, reference_type, reference_id, note)
       VALUES (?, ?, ?, 'sale_reversed', 'order', ?, ?)`
    ).bind(item.productId, item.size, item.qty, orderId, note).run();
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { customer, items, paymentMethod } = body || {};

  if (!customer || !customer.name || !customer.phone || !customer.address || !customer.city || !customer.pincode) {
    return jsonError('Missing required customer details');
  }
  const phone = String(customer.phone).trim();
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return jsonError('Enter a valid 10-digit phone number');
  }
  const pincode = String(customer.pincode).trim();
  if (!/^\d{6}$/.test(pincode)) {
    return jsonError('Enter a valid 6-digit pincode');
  }
  if (!Array.isArray(items) || items.length === 0) {
    return jsonError('Cart is empty');
  }
  if (!['razorpay', 'cod'].includes(paymentMethod)) {
    return jsonError('Invalid payment method');
  }

  // ── Re-price everything from D1 (source of truth) ──
  let productRows;
  try {
    const result = await env.DB.prepare(
      `SELECT p.id, p.slug, p.name, p.coming_soon, ps.size, ps.price
       FROM products p JOIN product_sizes ps ON ps.product_id = p.id`
    ).all();
    productRows = result.results || [];
  } catch {
    return jsonError('Could not verify product prices right now. Please try again.', 502);
  }

  let settings;
  try {
    const settingsUrl = new URL('/data/settings.json', request.url);
    const settingsRes = await fetch(settingsUrl.toString());
    if (!settingsRes.ok) throw new Error('fetch failed');
    settings = await settingsRes.json();
  } catch {
    return jsonError('Could not verify pricing settings right now. Please try again.', 502);
  }
  const { discountPercent, freeShippingThreshold, flatShippingFee } = settings.commerce;

  // Cart items are keyed by product NAME (matches how the cart has always
  // stored them — no slug client-side), so group D1 rows by name here too.
  const productByName = new Map();
  for (const row of productRows) {
    if (!productByName.has(row.name)) {
      productByName.set(row.name, { id: row.id, slug: row.slug, name: row.name, comingSoon: !!row.coming_soon, prices: {} });
    }
    productByName.get(row.name).prices[row.size] = row.price;
  }

  const validatedItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = productByName.get(item.name);
    if (!product) return jsonError(`Unknown product: ${item.name}`);
    if (product.comingSoon) return jsonError(`${product.name} is not yet available for purchase`);

    const qty = parseInt(item.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return jsonError(`Invalid quantity for ${product.name}`);
    }

    const originalPrice = product.prices[item.size];
    if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
      return jsonError(`Invalid size "${item.size}" for ${product.name}`);
    }

    const unitPrice = Math.round(originalPrice * (1 - discountPercent / 100));
    subtotal += unitPrice * qty;

    validatedItems.push({
      productId: product.id,
      product_slug: product.slug,
      product_name: product.name,
      size: item.size,
      qty,
      unit_price: unitPrice,
    });
  }

  const shippingFee = subtotal >= freeShippingThreshold ? 0 : flatShippingFee;
  const total = subtotal + shippingFee;

  const user = await getUserFromSession(request, env);
  if (!user) {
    return jsonError('Please log in to place an order.', 401);
  }
  const initialPaymentStatus = paymentMethod === 'cod' ? 'cod' : 'created';

  const insertResult = await env.DB.prepare(
    `INSERT INTO orders
       (user_id, customer_name, phone, email, address, city, pincode, subtotal, shipping_fee, total, status, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?)`
  ).bind(
    user ? user.id : null,
    String(customer.name).trim(),
    phone,
    customer.email ? String(customer.email).trim() : null,
    String(customer.address).trim(),
    String(customer.city).trim(),
    pincode,
    subtotal,
    shippingFee,
    total,
    initialPaymentStatus
  ).run();

  const orderId = insertResult.meta.last_row_id;

  for (const item of validatedItems) {
    await env.DB.prepare(
      `INSERT INTO order_items (order_id, product_slug, product_name, size, qty, unit_price)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(orderId, item.product_slug, item.product_name, item.size, item.qty, item.unit_price).run();
  }

  // ── Decrement stock. Guarded UPDATE (stock_qty >= qty in the WHERE)
  // means no separate read-then-write race window. On the first item that's
  // actually out of stock, roll back everything decremented so far plus the
  // order itself, then tell the customer which item failed. ──
  const decremented = [];
  for (const item of validatedItems) {
    const res = await env.DB.prepare(
      `UPDATE product_sizes SET stock_qty = stock_qty - ? WHERE product_id = ? AND size = ? AND stock_qty >= ?`
    ).bind(item.qty, item.productId, item.size, item.qty).run();

    if (res.meta.changes === 0) {
      await restoreStock(env, decremented, orderId, 'checkout rollback: another item in the same order was out of stock');
      await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run(); // cascades order_items
      return jsonError(`${item.product_name} (${item.size}) is out of stock`, 409);
    }

    decremented.push(item);
    await env.DB.prepare(
      `INSERT INTO inventory_movements (product_id, size, change_qty, reason, reference_type, reference_id)
       VALUES (?, ?, ?, 'sale', 'order', ?)`
    ).bind(item.productId, item.size, -item.qty, orderId).run();
  }

  if (paymentMethod === 'cod') {
    context.waitUntil(notifyOrderPlaced(env, {
      orderId, customerName: String(customer.name).trim(), phone, total,
      paymentMethod: 'cod', items: validatedItems,
    }));
    return new Response(JSON.stringify({
      orderId, subtotal, shippingFee, total, paymentMethod: 'cod',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  // ── Razorpay path ──
  try {
    const razorpayOrder = await createRazorpayOrder(env, total * 100, `order_${orderId}`);

    await env.DB.prepare(`UPDATE orders SET razorpay_order_id = ? WHERE id = ?`)
      .bind(razorpayOrder.id, orderId).run();

    context.waitUntil(notifyOrderPlaced(env, {
      orderId, customerName: String(customer.name).trim(), phone, total,
      paymentMethod: 'razorpay', items: validatedItems,
    }));

    return new Response(JSON.stringify({
      orderId,
      subtotal,
      shippingFee,
      total,
      paymentMethod: 'razorpay',
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // Order + items rows already exist and stock is already decremented —
    // mark payment as failed AND give the stock back, rather than leaving it
    // silently stuck on 'created' with no Razorpay order and no inventory.
    await env.DB.prepare(`UPDATE orders SET payment_status = 'failed' WHERE id = ?`).bind(orderId).run();
    await restoreStock(env, decremented, orderId, 'checkout rollback: Razorpay order creation failed');
    return jsonError('Could not initiate payment. Please try again.', 502);
  }
}
