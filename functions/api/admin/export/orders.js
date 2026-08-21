// functions/api/admin/export/orders.js
// GET /api/admin/export/orders?format=csv|json&from=&to=&status=&payment_status=
//
// admin + manager, same as GET /api/admin/orders. Adds from/to date
// filtering (on created_at) on top of that endpoint's existing
// status/payment_status filters, since exports are more likely to be
// scoped to a reporting period than the live admin orders list is.
//
// Uses a batched item fetch (one query for all matching orders' items)
// rather than the per-order loop admin/orders.js used to have — see that
// file for the same fix applied to the live endpoint.
 
import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { toCsv, csvResponse, jsonDownloadResponse, exportFilename } from '../../_utils/export.js';
 
const VALID_STATUS = ['placed', 'packed', 'shipped', 'delivered', 'cancelled'];
const VALID_PAYMENT_STATUS = ['created', 'paid', 'failed', 'cod'];
const MAX_ROWS = 5000; // sane upper bound so an unfiltered export can't run away
 
export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();
 
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  if (!['csv', 'json'].includes(format)) return jsonError('format must be csv or json');
 
  const statusFilter = url.searchParams.get('status');
  const paymentFilter = url.searchParams.get('payment_status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (statusFilter && !VALID_STATUS.includes(statusFilter)) {
    return jsonError(`status must be one of: ${VALID_STATUS.join(', ')}`);
  }
  if (paymentFilter && !VALID_PAYMENT_STATUS.includes(paymentFilter)) {
    return jsonError(`payment_status must be one of: ${VALID_PAYMENT_STATUS.join(', ')}`);
  }
 
  let query = `SELECT id, user_id, customer_name, phone, email, address, city, pincode,
                      subtotal, shipping_fee, total, status, payment_status,
                      razorpay_order_id, razorpay_payment_id, coupon_code, coupon_discount_amount,
                      created_at, updated_at
               FROM orders WHERE 1=1`;
  const binds = [];
  if (statusFilter) { query += ' AND status = ?'; binds.push(statusFilter); }
  if (paymentFilter) { query += ' AND payment_status = ?'; binds.push(paymentFilter); }
  if (from) { query += ' AND date(created_at) >= date(?)'; binds.push(from); }
  if (to) { query += ' AND date(created_at) <= date(?)'; binds.push(to); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(MAX_ROWS);
 
  const ordersResult = await env.DB.prepare(query).bind(...binds).all();
  const orders = ordersResult.results || [];
 
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
 
  context.waitUntil(logAudit(env, {
    userId: user.id, action: 'export', resource: 'orders',
    diff: { format, rowCount: orders.length, from: from || null, to: to || null },
  }));
 
  if (format === 'json') {
    return jsonDownloadResponse({ orders }, exportFilename('orders', 'json'));
  }
 
  // CSV: one row per order item, order fields repeated. Item-less orders
  // (shouldn't happen, but don't want to silently drop the order row) get
  // one row with blank item fields.
  const flatRows = [];
  for (const o of orders) {
    const itemList = (o.items && o.items.length)
      ? o.items
      : [{ product_slug: '', product_name: '', size: '', qty: '', unit_price: '' }];
    for (const item of itemList) {
      flatRows.push({
        order_id: o.id, customer_name: o.customer_name, phone: o.phone, email: o.email,
        address: o.address, city: o.city, pincode: o.pincode,
        subtotal: o.subtotal, shipping_fee: o.shipping_fee, total: o.total,
        status: o.status, payment_status: o.payment_status,
        coupon_code: o.coupon_code || '', coupon_discount_amount: o.coupon_discount_amount || 0,
        razorpay_order_id: o.razorpay_order_id || '', razorpay_payment_id: o.razorpay_payment_id || '',
        created_at: o.created_at, updated_at: o.updated_at,
        product_slug: item.product_slug, product_name: item.product_name,
        size: item.size, qty: item.qty, unit_price: item.unit_price,
      });
    }
  }
  const columns = [
    { key: 'order_id', header: 'Order ID' }, { key: 'customer_name', header: 'Customer' },
    { key: 'phone', header: 'Phone' }, { key: 'email', header: 'Email' },
    { key: 'address', header: 'Address' }, { key: 'city', header: 'City' }, { key: 'pincode', header: 'Pincode' },
    { key: 'subtotal', header: 'Subtotal' }, { key: 'shipping_fee', header: 'Shipping Fee' }, { key: 'total', header: 'Total' },
    { key: 'status', header: 'Status' }, { key: 'payment_status', header: 'Payment Status' },
    { key: 'coupon_code', header: 'Coupon Code' }, { key: 'coupon_discount_amount', header: 'Coupon Discount' },
    { key: 'razorpay_order_id', header: 'Razorpay Order ID' }, { key: 'razorpay_payment_id', header: 'Razorpay Payment ID' },
    { key: 'created_at', header: 'Created At' }, { key: 'updated_at', header: 'Updated At' },
    { key: 'product_slug', header: 'Item Slug' }, { key: 'product_name', header: 'Item Name' },
    { key: 'size', header: 'Item Size' }, { key: 'qty', header: 'Item Qty' }, { key: 'unit_price', header: 'Item Unit Price' },
  ];
  return csvResponse(toCsv(flatRows, columns), exportFilename('orders', 'csv'));
}