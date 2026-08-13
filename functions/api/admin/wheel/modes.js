// functions/api/admin/wheel/modes.js
// GET    /api/admin/wheel/modes            — list all modes, incl inactive (admin + manager)
// POST   /api/admin/wheel/modes            — create a mode
// PATCH  /api/admin/wheel/modes            { id, updates }
// DELETE /api/admin/wheel/modes?id=...     — cascades wheel_items
//
// Managed from the Flutter admin app. See items.js for the wedge side.

import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

const EDITABLE_FIELDS = {
  key: 'key',
  sortOrder: 'sort_order',
  centerLabel: 'center_label',
  centerLabelHover: 'center_label_hover',
  centerGlyph: 'center_glyph',
  hubHref: 'hub_href',
  isActive: 'is_active',
};

function slugify(v) {
  return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function rowToJson(row) {
  return {
    id: row.id,
    key: row.key,
    sortOrder: row.sort_order,
    centerLabel: row.center_label,
    centerLabelHover: row.center_label_hover,
    centerGlyph: row.center_glyph,
    hubHref: row.hub_href,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const result = await env.DB.prepare(`SELECT * FROM wheel_modes ORDER BY sort_order, id`).all();
  return new Response(JSON.stringify({ modes: (result.results || []).map(rowToJson) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const centerLabel = (body.centerLabel || '').trim();
  if (!centerLabel) return jsonError('centerLabel is required');
  const key = slugify(body.key || centerLabel);
  if (!key) return jsonError('Could not derive a valid key');

  const existing = await env.DB.prepare('SELECT id FROM wheel_modes WHERE key = ?').bind(key).first();
  if (existing) return jsonError(`A mode with key "${key}" already exists`, 409);

  const maxSort = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM wheel_modes').first();

  const result = await env.DB.prepare(
    `INSERT INTO wheel_modes (key, sort_order, center_label, center_label_hover, center_glyph, hub_href, is_active, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    key,
    Number.isInteger(body.sortOrder) ? body.sortOrder : (maxSort?.m ?? -1) + 1,
    centerLabel,
    body.centerLabelHover || null,
    body.centerGlyph || '✦',
    body.hubHref || null,
    body.isActive === false ? 0 : 1,
    user.id, user.id
  ).run();

  await logAudit(env, { userId: user.id, action: 'create', resource: 'wheel_mode', resourceId: key, diff: { centerLabel } });

  const row = await env.DB.prepare('SELECT * FROM wheel_modes WHERE id = ?').bind(result.meta.last_row_id).first();
  return new Response(JSON.stringify({ ok: true, mode: rowToJson(row) }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { id, updates } = body;
  if (!Number.isInteger(id)) return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const existing = await env.DB.prepare('SELECT id FROM wheel_modes WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Mode not found', 404);

  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
    if (!(key in updates)) continue;
    let val = updates[key];
    if (key === 'key') val = slugify(val);
    if (key === 'isActive') val = val ? 1 : 0;
    sets.push(`${column} = ?`);
    binds.push(val ?? null);
  }
  if (!sets.length) return jsonError('No editable fields provided');

  sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
  binds.push(user.id, id);

  try {
    await env.DB.prepare(`UPDATE wheel_modes SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return jsonError('That key is already in use by another mode', 409);
    throw err;
  }

  await logAudit(env, { userId: user.id, action: 'update', resource: 'wheel_mode', resourceId: id, diff: updates });

  const row = await env.DB.prepare('SELECT * FROM wheel_modes WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ ok: true, mode: rowToJson(row) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return jsonError('id query param is required');

  const row = await env.DB.prepare('SELECT id, key FROM wheel_modes WHERE id = ?').bind(id).first();
  if (!row) return jsonError('Mode not found', 404);

  await env.DB.prepare('DELETE FROM wheel_modes WHERE id = ?').bind(id).run(); // cascades wheel_items
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'wheel_mode', resourceId: row.key });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}