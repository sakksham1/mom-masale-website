// GET /api/requests/mine?limit=100
// Returns everything the logged-in user has personally submitted across the
// three approval-gated tables, regardless of role — a packaging user's
// rawMaterial/productStock arrays just come back empty since requested_by
// won't match, so no role gate is needed beyond being logged in.

import { getUserFromSession } from '../_utils/session.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));

  const [packaging, rawMaterial, productStock] = await Promise.all([
    env.DB.prepare(
      `SELECT pr.id, pr.product_id, pd.slug as product_slug, pd.name as product_name, pr.size, pr.qty,
              pr.report_date, pr.status, pr.reviewed_at, pr.created_at
       FROM packaging_reports pr JOIN products pd ON pd.id = pr.product_id
       WHERE pr.user_id = ? ORDER BY pr.created_at DESC LIMIT ?`
    ).bind(user.id, limit).all(),
    env.DB.prepare(
      `SELECT t.id, t.raw_material_id, m.name as material_name, t.delta, t.reason, t.note,
              t.input_amount, t.input_unit, t.status, t.reviewed_at, t.created_at
       FROM raw_material_transactions t JOIN raw_materials m ON m.id = t.raw_material_id
       WHERE t.requested_by = ? ORDER BY t.created_at DESC LIMIT ?`
    ).bind(user.id, limit).all(),
    env.DB.prepare(
      `SELECT t.id, t.product_id, p.slug as product_slug, p.name as product_name, t.size, t.change_qty,
              t.reason, t.note, t.status, t.reviewed_at, t.created_at
       FROM product_stock_transactions t JOIN products p ON p.id = t.product_id
       WHERE t.requested_by = ? ORDER BY t.created_at DESC LIMIT ?`
    ).bind(user.id, limit).all(),
  ]);

  return new Response(JSON.stringify({
    packaging: packaging.results || [],
    rawMaterial: rawMaterial.results || [],
    productStock: productStock.results || [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}