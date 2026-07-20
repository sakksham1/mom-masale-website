// GET  /api/admin/notifications?limit=20&unreadOnly=1
// POST /api/admin/notifications   { id? }   — mark one (or all, if omitted) as read
import { requireAdmin, forbidden } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const unreadOnly = url.searchParams.get('unreadOnly') === '1';

  let query = `SELECT id, type, title, body, reference_type, reference_id, read_at, created_at FROM notifications WHERE 1=1`;
  if (unreadOnly) query += ' AND read_at IS NULL';
  query += ' ORDER BY id DESC LIMIT ?';

  const result = await env.DB.prepare(query).bind(limit).all();
  const unreadRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL`).first();

  return new Response(JSON.stringify({ notifications: result.results || [], unreadCount: unreadRow.c }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { body = {}; }

  if (body.id) {
    await env.DB.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`).bind(body.id).run();
  } else {
    await env.DB.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`).run();
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}