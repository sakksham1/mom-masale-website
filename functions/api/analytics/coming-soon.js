// GET /api/admin/analytics/coming-soon?days=30
// Clicks on "Launching Soon" panels, per product — direct prioritization
// signal for what to actually launch next.

import { requireRole, forbidden } from '../../_utils/admin.js';
import { parseDaysParam } from '../../_utils/analytics.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const { days, sinceClause } = parseDaysParam(url);

  const result = await env.DB.prepare(
    `SELECT json_extract(payload, '$.productSlug') as productSlug,
            json_extract(payload, '$.productName') as productName,
            COUNT(*) as clicks,
            COUNT(DISTINCT anon_id) as uniqueVisitors,
            MAX(created_at) as lastSeen
     FROM analytics_events
     WHERE event_type = 'coming_soon_click' AND created_at >= ${sinceClause}
     GROUP BY productSlug
     ORDER BY clicks DESC`
  ).all();

  return new Response(JSON.stringify({ days, products: result.results || [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}