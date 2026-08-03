// functions/api/warehouse/raw-materials/adjust.js
// POST /api/warehouse/raw-materials/adjust
//   { rawMaterialId, amount, unit, reason, note? }
// warehouser or packaging. Doesn't change qty immediately — files a pending
// raw_material_transactions row that a manager/admin approves via
// /api/manager/approvals/decide.
//
// `amount` is a SIGNED quantity in `unit`, which may be the material's base
// unit (kg/l/units) or its everyday sub-unit (g/ml) — e.g. { amount: -350,
// unit: 'g' } for "used 350g". The base-unit delta is what actually gets
// applied to stock; amount/unit are kept alongside it (input_amount/
// input_unit) purely so Approvals/history can display "−350 g" verbatim
// instead of a fiddly "-0.35".

import { requireRole, forbidden, jsonError } from '../../_utils/admin.js';
import { createNotification } from '../../_utils/notify.js';
import { toBaseUnit } from '../../_utils/units.js';

const REASONS = ['restock', 'consumption', 'correction'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['warehouser']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { rawMaterialId, unit, reason, note } = body;
  const amount = Number(body.amount);

  if (!Number.isInteger(rawMaterialId)) return jsonError('rawMaterialId is required');
  if (!Number.isFinite(amount) || amount === 0) return jsonError('amount must be a non-zero number');
  if (!unit) return jsonError('unit is required');
  if (!REASONS.includes(reason)) return jsonError(`reason must be one of: ${REASONS.join(', ')}`);

  const material = await env.DB.prepare('SELECT id, name, qty, unit FROM raw_materials WHERE id = ?')
    .bind(rawMaterialId).first();
  if (!material) return jsonError('Raw material not found', 404);

  let delta;
  try {
    delta = toBaseUnit(material.unit, amount, unit);
  } catch (err) {
    return jsonError(err.message);
  }

  if (delta < 0 && material.qty + delta < 0) {
    return jsonError(`That would take stock negative (currently ${material.qty} ${material.unit})`);
  }

  const result = await env.DB.prepare(
    `INSERT INTO raw_material_transactions (raw_material_id, delta, reason, note, requested_by, input_amount, input_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(rawMaterialId, delta, reason, note || null, user.id, amount, unit).run();

  context.waitUntil(createNotification(env, {
    type: 'approval_requested',
    title: 'Raw material adjustment pending',
    body: `${material.name}: ${amount > 0 ? '+' : ''}${amount} ${unit} (${reason}) — requested by ${user.name}`,
    referenceType: 'raw_material',
    referenceId: result.meta.last_row_id,
  }));

  return new Response(JSON.stringify({ ok: true, transactionId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}