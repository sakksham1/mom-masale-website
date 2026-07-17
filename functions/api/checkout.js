// functions/api/checkout.js
// POST /api/checkout
// Body: { customer: {name, phone, email?, address, city, pincode},
//         items: [{name, size, qty}], paymentMethod: 'razorpay' | 'cod' }
//
// CRITICAL: prices are never trusted from the client. This Function re-fetches
// data/products.json and recomputes the subtotal from scratch — the client's
// cart only tells us WHICH products and HOW MANY, never how much they cost.

import { getUserFromSession } from './_utils/session.js';
import { createRazorpayOrder } from './_utils/razorpay.js';
import { notifyOrderPlaced } from './_utils/notify.js';

const FREE_SHIPPING_THRESHOLD = 499;
const FLAT_SHIPPING_FEE = 40;
const DISCOUNT_PERCENT = 25; // must match the discount baked into products.html / build-site.js

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  // ── Re-price everything from the source of truth ──
  let products;
  try {
    const productsUrl = new URL('/data/products.json', request.url);
    const productsRes = await fetch(productsUrl.toString());
    if (!productsRes.ok) throw new Error('fetch failed');
    products = await productsRes.json();
  } catch {
    return jsonError('Could not verify product prices right now. Please try again.', 502);
  }

  // Cart items are keyed by product NAME (matches how the existing cart in
  // main.js stores them — no slug in localStorage), so match on name here
  // and pull the slug from the matched product record for storage.
  const productByName = new Map(products.map(p => [p.name, p]));

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

    const originalPrice = product.prices && product.prices[item.size];
    if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
      return jsonError(`Invalid size "${item.size}" for ${product.name}`);
    }

    const unitPrice = Math.round(originalPrice * (1 - DISCOUNT_PERCENT / 100));
    subtotal += unitPrice * qty;

    validatedItems.push({
      product_slug: product.slug,
      product_name: product.name,
      size: item.size,
      qty,
      unit_price: unitPrice,
    });
  }

  const shippingFee = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING_FEE;
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
    // Order + items rows already exist — mark payment as failed rather than
    // leaving it silently stuck on 'created' with no Razorpay order behind it.
    await env.DB.prepare(`UPDATE orders SET payment_status = 'failed' WHERE id = ?`).bind(orderId).run();
    return jsonError('Could not initiate payment. Please try again.', 502);
  }
}
