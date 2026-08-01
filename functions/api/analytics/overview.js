// GET /api/admin/analytics/overview?days=30
// General "what's happening" view: totals per event type + a daily time
// series, for a dashboard landing page / chart. admin + manager (read-only,
// same visibility pattern as admin/stats.js).

import { requireRole, forbidden } from '../../_utils/admin.js';
import { ANALYTICS_EVENT_TYPES, parseDaysParam } from '../../_utils/analytics.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const { days, sinceClause } = parseDaysParam(url);

  const totalsResult = await env.DB.prepare(
    `SELECT event_type, COUNT(*) as count, COUNT(DISTINCT anon_id) as uniqueVisitors
     FROM analytics_events
     WHERE created_at >= ${sinceClause}
     GROUP BY event_type`
  ).all();

  const dailyResult = await env.DB.prepare(
    `SELECT date(created_at) as day, event_type, COUNT(*) as count
     FROM analytics_events
     WHERE created_at >= ${sinceClause}
     GROUP BY day, event_type
     ORDER BY day ASC`
  ).all();

  const totals = {};
  ANALYTICS_EVENT_TYPES.forEach(t => { totals[t] = { count: 0, uniqueVisitors: 0 }; });
  for (const row of totalsResult.results || []) {
    totals[row.event_type] = { count: row.count, uniqueVisitors: row.uniqueVisitors };
  }

  return new Response(JSON.stringify({
    days,
    totals,       // { [eventType]: { count, uniqueVisitors } }
    daily: dailyResult.results || [],   // [{ day, event_type, count }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}