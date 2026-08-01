// GET /api/admin/analytics/filters?scope=products|recipes&days=30&limit=50
// Most common filter combinations actually applied together — tells you real
// demand shape (e.g. "Blended Spices" + "200g" is the #1 combo) rather than
// guessing from the catalog structure.

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
    SELECT json_extract(payload, '$.scope') as scope,
           json_extract(payload, '$.categories') as categoriesJson,
           json_extract(payload, '$.sizes') as sizesJson,
           COUNT(*) as count,
           COUNT(DISTINCT anon_id) as uniqueVisitors
    FROM analytics_events
    WHERE event_type = 'filter_applied' AND created_at >= ${sinceClause}`;
  const binds = [];
  if (scope) { query += ` AND json_extract(payload, '$.scope') = ?`; binds.push(scope); }
  query += ' GROUP BY scope, categoriesJson, sizesJson ORDER BY count DESC LIMIT ?';
  binds.push(limit);

  const result = await env.DB.prepare(query).bind(...binds).all();
  const combos = (result.results || []).map(r => ({
    scope: r.scope,
    categories: JSON.parse(r.categoriesJson || '[]'),
    sizes: JSON.parse(r.sizesJson || '[]'),
    count: r.count,
    uniqueVisitors: r.uniqueVisitors,
  }));

  return new Response(JSON.stringify({ days, scope: scope || 'all', combos }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}