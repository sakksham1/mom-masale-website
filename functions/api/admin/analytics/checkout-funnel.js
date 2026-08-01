// GET /api/admin/analytics/checkout-funnel?days=30
// Distinct-session counts at each checkout step, in canonical funnel order,
// with drop-off % from the previous step. This counts "did this session ever
// reach step X" rather than assuming a strict linear sequence per session
// (someone can bounce and come back) — that's the useful question for
// finding where people give up, and it directly informs the
// abandoned/stale-order-cleanup work already flagged as pending.

import { requireRole, forbidden } from '../../_utils/admin.js';
import { CHECKOUT_FUNNEL_STEPS, parseDaysParam } from '../../_utils/analytics.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const { days, sinceClause } = parseDaysParam(url);

  const result = await env.DB.prepare(
    `SELECT json_extract(payload, '$.step') as step,
            COUNT(DISTINCT session_id) as sessions,
            COUNT(*) as events
     FROM analytics_events
     WHERE event_type = 'checkout_step' AND created_at >= ${sinceClause}
     GROUP BY step`
  ).all();

  const byStep = {};
  for (const row of result.results || []) byStep[row.step] = { sessions: row.sessions, events: row.events };

  let previousSessions = null;
  const funnel = CHECKOUT_FUNNEL_STEPS.map(step => {
    const data = byStep[step] || { sessions: 0, events: 0 };
    const dropOffPercent = previousSessions
      ? Math.round((1 - data.sessions / previousSessions) * 1000) / 10
      : null;
    previousSessions = data.sessions;
    return { step, sessions: data.sessions, events: data.events, dropOffPercent };
  });

  return new Response(JSON.stringify({ days, funnel }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}