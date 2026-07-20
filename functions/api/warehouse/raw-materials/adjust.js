// functions/api/warehouse/raw-materials/adjust.js
// POST { rawMaterialId, delta, reason, note? }
// Just files the request — qty is NOT touched here. See approvals.js for
// where 'pending' becomes 'approved' and the stock actually moves.

import { requireRole, forbidden, jsonError } from '../../_utils/admin.js';

const REASONS = ['restock', 'consumption', 'correction'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['warehouser']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { rawMaterialId, delta, reason, note } = body;
  if (!Number.isInteger(rawMaterialId)) return jsonError('rawMaterialId is required');
  if (!Number.isFinite(delta) || delta === 0) return jsonError('delta must be a non-zero number');
  if (!REASONS.includes(reason)) return jsonError(`reason must be one of: ${REASONS.join(', ')}`);

  const material = await env.DB.prepare('SELECT id, qty, unit FROM raw_materials WHERE id = ?')
    .bind(rawMaterialId).first();
  if (!material) return jsonError('Raw material not found', 404);
  if (delta < 0 && material.qty + delta < 0) {
    return jsonError(`Delta would take stock negative (current: ${material.qty} ${material.unit})`);
  }

  const result = await env.DB.prepare(
    `INSERT INTO raw_material_transactions (raw_material_id, delta, reason, note, requested_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(rawMaterialId, delta, reason, note || null, user.id).run();

  return new Response(JSON.stringify({ ok: true, transactionId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}