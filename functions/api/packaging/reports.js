import { requireRole, forbidden, jsonError } from '../_utils/admin.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['packaging']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, size, qty } = body;
  const reportDate = body.reportDate || todayISO();

  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!size) return jsonError('size is required');
  if (!Number.isInteger(qty) || qty <= 0) return jsonError('qty must be a positive integer');

  const sizeRow = await env.DB.prepare(
    `SELECT id FROM product_sizes WHERE product_id = ? AND size = ?`
  ).bind(productId, size).first();
  if (!sizeRow) return jsonError('Unknown product/size combination', 400);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO packaging_reports (user_id, product_id, size, qty, report_date) VALUES (?, ?, ?, ?, ?)`
    ).bind(user.id, productId, size, qty, reportDate).run();

    return new Response(JSON.stringify({ ok: true, reportId: result.meta.last_row_id, status: 'pending' }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return jsonError(`Already reported this product/size for ${reportDate}. Ask a manager to correct it.`, 409);
    }
    throw err;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireRole(request, env, ['packaging', 'manager', 'admin']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const scopeToSelf = url.searchParams.get('mine') === '1' || !['manager', 'admin'].includes(role);

  let query = `SELECT r.id, r.user_id, r.product_id, p.name as product_name, r.size, r.qty,
                      r.report_date, r.status, r.reviewed_at, r.created_at
               FROM packaging_reports r JOIN products p ON p.id = r.product_id WHERE 1=1`;
  const binds = [];
  if (scopeToSelf) { query += ' AND r.user_id = ?'; binds.push(user.id); }
  query += ' ORDER BY r.report_date DESC, r.created_at DESC LIMIT 200';

  const result = await env.DB.prepare(query).bind(...binds).all();
  return new Response(JSON.stringify({ reports: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}