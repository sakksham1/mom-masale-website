// GET /api/admin/analytics/recipe-conversion?days=30&limit=50
// "Shop the Ingredient" click volume per recipe -> product pair. This is a
// directional interest signal (which recipes drive product clicks), not a
// confirmed purchase-attribution report — matching these clicks to completed
// orders would need anonId plumbed through checkout too, which isn't wired
// up yet (noted as a possible future enhancement, not built here).

import { requireRole, forbidden } from '../../_utils/admin.js';
import { parseDaysParam } from '../../_utils/analytics.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const { days, sinceClause } = parseDaysParam(url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  const result = await env.DB.prepare(
    `SELECT json_extract(payload, '$.recipeSlug') as recipeSlug,
            json_extract(payload, '$.productSlug') as productSlug,
            COUNT(*) as clicks,
            COUNT(DISTINCT anon_id) as uniqueVisitors
     FROM analytics_events
     WHERE event_type = 'recipe_ingredient_click' AND created_at >= ${sinceClause}
     GROUP BY recipeSlug, productSlug
     ORDER BY clicks DESC
     LIMIT ?`
  ).bind(limit).all();

  return new Response(JSON.stringify({
    days,
    pairs: result.results || [],
    note: 'Click volume only — not yet correlated to completed purchases.',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}