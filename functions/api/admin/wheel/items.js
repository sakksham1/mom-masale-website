// functions/api/admin/wheel/items.js
// GET    /api/admin/wheel/items?modeId=123   — list a mode's wedges (admin + manager)
// POST   /api/admin/wheel/items              { modeId, label, href, color?, sortOrder? }
// PATCH  /api/admin/wheel/items              { id, updates }
// DELETE /api/admin/wheel/items?id=...

import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

const EDITABLE_FIELDS = { label: 'label', href: 'href', color: 'color', sortOrder: 'sort_order' };

function rowToJson(row) {
  return {
    id: row.id, modeId: row.mode_id, label: row.label, href: row.href,
    color: row.color, sortOrder: row.sort_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const modeId = Number(url.searchParams.get('modeId'));
  if (!Number.isInteger(modeId)) return jsonError('modeId query param is required');

  const result = await env.DB.prepare(
    `SELECT * FROM wheel_items WHERE mode_id = ? ORDER BY sort_order, id`
  ).bind(modeId).all();
  return new Response(JSON.stringify({ items: (result.results || []).map(rowToJson) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const modeId = Number(body.modeId);
  const label = (body.label || '').trim();
  const href = (body.href || '').trim();
  if (!Number.isInteger(modeId)) return jsonError('modeId is required');
  if (!label) return jsonError('label is required');
  if (!href) return jsonError('href is required');

  const mode = await env.DB.prepare('SELECT id FROM wheel_modes WHERE id = ?').bind(modeId).first();
  if (!mode) return jsonError('Unknown modeId', 404);

  const maxSort = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM wheel_items WHERE mode_id = ?'
  ).bind(modeId).first();

  const result = await env.DB.prepare(
    `INSERT INTO wheel_items (mode_id, label, href, color, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).bind(
    modeId, label, href, body.color || null,
    Number.isInteger(body.sortOrder) ? body.sortOrder : (maxSort?.m ?? -1) + 1
  ).run();

  await logAudit(env, { userId: user.id, action: 'create', resource: 'wheel_item', resourceId: result.meta.last_row_id, diff: { modeId, label, href } });

  const row = await env.DB.prepare('SELECT * FROM wheel_items WHERE id = ?').bind(result.meta.last_row_id).first();
  return new Response(JSON.stringify({ ok: true, item: rowToJson(row) }), {
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

  const existing = await env.DB.prepare('SELECT id FROM wheel_items WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Item not found', 404);

  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
    if (!(key in updates)) continue;
    sets.push(`${column} = ?`);
    binds.push(updates[key] ?? null);
  }
  if (!sets.length) return jsonError('No editable fields provided');

  sets.push(`updated_at = datetime('now')`);
  binds.push(id);
  await env.DB.prepare(`UPDATE wheel_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  await logAudit(env, { userId: user.id, action: 'update', resource: 'wheel_item', resourceId: id, diff: updates });

  const row = await env.DB.prepare('SELECT * FROM wheel_items WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ ok: true, item: rowToJson(row) }), {
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

  const row = await env.DB.prepare('SELECT id FROM wheel_items WHERE id = ?').bind(id).first();
  if (!row) return jsonError('Item not found', 404);

  await env.DB.prepare('DELETE FROM wheel_items WHERE id = ?').bind(id).run();
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'wheel_item', resourceId: id });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}