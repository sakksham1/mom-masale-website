// GET  /api/warehouse/raw-materials         — warehouser, packaging (read), manager, admin
// POST /api/warehouse/raw-materials          { name, unit, qty?, lowStockThreshold? } — warehouser only

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';

const VIEW_ROLES = ['warehouser', 'packaging', 'manager', 'admin'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, VIEW_ROLES);
  if (!ok) return forbidden();

  const result = await env.DB.prepare(
    `SELECT id, name, unit, qty, low_stock_threshold, updated_at FROM raw_materials ORDER BY name`
  ).all();
  return new Response(JSON.stringify({ rawMaterials: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

const UNITS = ['kg', 'l', 'units'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['warehouser']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const name = (body.name || '').trim();
  const unit = body.unit;
  const qty = Number.isFinite(body.qty) ? body.qty : 0;
  const lowStockThreshold = Number.isFinite(body.lowStockThreshold) ? body.lowStockThreshold : null;

  if (!name) return jsonError('name is required');
  if (!UNITS.includes(unit)) return jsonError(`unit must be one of: ${UNITS.join(', ')}`);
  if (qty < 0) return jsonError('qty cannot be negative');

  try {
    const result = await env.DB.prepare(
      `INSERT INTO raw_materials (name, unit, qty, low_stock_threshold) VALUES (?, ?, ?, ?)`
    ).bind(name, unit, qty, lowStockThreshold).run();

    return new Response(JSON.stringify({ ok: true, id: result.meta.last_row_id }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return jsonError(`"${name}" already exists`, 409);
    throw err;
  }
}