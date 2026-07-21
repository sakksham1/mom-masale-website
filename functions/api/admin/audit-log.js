// GET /api/admin/audit-log?limit=20&beforeId=123 — cursor-paginated, newest first
import { requireRole, forbidden } from '../_utils/admin.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const beforeId = Number(url.searchParams.get('beforeId')) || null;

  let query = `SELECT a.id, a.user_id, u.name as user_name, a.action, a.resource, a.resource_id, a.diff, a.created_at
               FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const binds = [];
  if (beforeId) { query += ' AND a.id < ?'; binds.push(beforeId); }
  query += ' ORDER BY a.id DESC LIMIT ?';
  binds.push(limit + 1);

  const result = await env.DB.prepare(query).bind(...binds).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const logs = (hasMore ? rows.slice(0, limit) : rows).map(r => ({ ...r, diff: r.diff ? JSON.parse(r.diff) : null }));

  return new Response(JSON.stringify({ logs, hasMore }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}