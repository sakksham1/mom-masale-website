// GET /api/admin/analytics/search-terms?scope=products|recipes&days=30&limit=50
// Top search queries that returned zero results — signal for missing
// products/aliases (products scope) or missing recipe content (recipes scope).

import { requireRole, forbidden, jsonError } from '../../_utils/admin.js';
import { parseDaysParam } from '../../_utils/analytics.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const { days, sinceClause } = parseDaysParam(url);
  const scope = url.searchParams.get('scope');
  if (scope && !['products', 'recipes'].includes(scope)) {
    return jsonError('scope must be "products" or "recipes"');
  }
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  let query = `
    SELECT json_extract(payload, '$.query') as query,
           json_extract(payload, '$.scope') as scope,
           COUNT(*) as count,
           COUNT(DISTINCT anon_id) as uniqueVisitors,
           MAX(created_at) as lastSeen
    FROM analytics_events
    WHERE event_type = 'search_zero_result' AND created_at >= ${sinceClause}`;
  const binds = [];
  if (scope) { query += ` AND json_extract(payload, '$.scope') = ?`; binds.push(scope); }
  query += ' GROUP BY query, scope ORDER BY count DESC LIMIT ?';
  binds.push(limit);

  const result = await env.DB.prepare(query).bind(...binds).all();

  return new Response(JSON.stringify({ days, scope: scope || 'all', terms: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}