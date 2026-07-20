// GET  /api/manager/approvals                 — unified pending queue across all approval-gated tables
// POST /api/manager/approvals/decide           { type, id, decision: 'approved'|'rejected' }

import { requireApprover, forbidden, jsonError, logAudit } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireApprover(request, env);
  if (!ok) return forbidden();

  const [rawMaterial, packaging, productCore] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.raw_material_id, m.name as material_name, t.delta, t.reason, t.note,
              t.requested_by, u.name as requested_by_name, t.created_at
       FROM raw_material_transactions t
       JOIN raw_materials m ON m.id = t.raw_material_id
       JOIN users u ON u.id = t.requested_by
       WHERE t.status = 'pending' ORDER BY t.created_at`
    ).all(),
    env.DB.prepare(
      `SELECT p.id, p.product_slug, p.size, p.qty, p.report_date,
              p.user_id, u.name as requested_by_name, p.created_at
       FROM packaging_reports p JOIN users u ON u.id = p.user_id
       WHERE p.status = 'pending' ORDER BY p.created_at`
    ).all(),
    env.DB.prepare(
      `SELECT c.id, c.product_slug, c.field, c.payload,
              c.requested_by, u.name as requested_by_name, c.created_at
       FROM product_core_change_requests c JOIN users u ON u.id = c.requested_by
       WHERE c.status = 'pending' ORDER BY c.created_at`
    ).all(),
  ]);

  return new Response(JSON.stringify({
    rawMaterial: rawMaterial.results || [],
    packaging: packaging.results || [],
    productCore: productCore.results || [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}