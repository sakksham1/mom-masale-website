// GET  /api/manager/approvals                 — unified pending queue across all approval-gated tables
// POST /api/manager/approvals/decide           { type, id, decision: 'approved'|'rejected' }

import { requireApprover, forbidden, jsonError, logAudit } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireApprover(request, env);
  if (!ok) return forbidden();

  const [rawMaterial, packaging, productCore, productStock] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.raw_material_id, m.name as material_name, t.delta, t.reason, t.note,
              t.requested_by, u.name as requested_by_name, t.created_at
       FROM raw_material_transactions t
       JOIN raw_materials m ON m.id = t.raw_material_id
       JOIN users u ON u.id = t.requested_by
       WHERE t.status = 'pending' ORDER BY t.created_at`
    ).all(),
    env.DB.prepare(
      `SELECT pr.id, pr.product_id, pd.slug as product_slug, pd.name as product_name,
              pr.size, pr.qty, pr.report_date,
              pr.user_id, u.name as requested_by_name, pr.created_at
       FROM packaging_reports pr
       JOIN products pd ON pd.id = pr.product_id
       JOIN users u ON u.id = pr.user_id
       WHERE pr.status = 'pending' ORDER BY pr.created_at`
    ).all(),
    env.DB.prepare(
      `SELECT c.id, c.product_id, pd.slug as product_slug, pd.name as product_name,
              c.field, c.payload,
              c.requested_by, u.name as requested_by_name, c.created_at
       FROM product_core_change_requests c
       JOIN products pd ON pd.id = c.product_id
       JOIN users u ON u.id = c.requested_by
       WHERE c.status = 'pending' ORDER BY c.created_at`
    ).all(),
    env.DB.prepare(
    `SELECT t.id, t.product_id, p.slug as product_slug, p.name as product_name,
            t.size, t.change_qty, t.reason, t.note,
            t.requested_by, u.name as requested_by_name, t.created_at
     FROM product_stock_transactions t
     JOIN products p ON p.id = t.product_id
     JOIN users u ON u.id = t.requested_by
     WHERE t.status = 'pending' ORDER BY t.created_at`
  ).all(),
  ]);

  return new Response(JSON.stringify({
    rawMaterial: rawMaterial.results || [],
    packaging: packaging.results || [],
    productCore: productCore.results || [],
    productStock: productStock.results || [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}