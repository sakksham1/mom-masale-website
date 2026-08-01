// functions/api/analytics/event.js
// POST /api/analytics/event
//
// Public, unauthenticated ingest for first-party product analytics —
// deliberately separate from GA/Cloudflare Web Analytics, which have no idea
// about this site's specific funnel (search terms, filter combos, checkout
// drop-off, recipe→product interest). No PII: anonId/sessionId are random
// client-generated ids with no link to a user account.
//
// Call with fetch(url, {method:'POST', body, keepalive:true}) or
// navigator.sendBeacon(url, body) — fire-and-forget, don't await before nav.
//
// Body: a single event object, OR { events: [ ...up to 20 event objects ] }
//   {
//     type: one of ANALYTICS_EVENT_TYPES (see _utils/analytics.js),
//     payload: { ... shape depends on type, see _utils/analytics.js },
//     anonId?: string,     // persistent per-browser id, e.g. crypto.randomUUID()
//                           // generated once and stored in localStorage
//     sessionId?: string,  // per checkout-attempt id, e.g. stored in
//                           // sessionStorage, reused across all checkout_step
//                           // events in the same flow so they group together
//     path?: string,       // optional override; otherwise derived from the
//                           // Referer header
//   }

import { ANALYTICS_EVENT_TYPES, validateEventPayload } from '../_utils/analytics.js';

const MAX_EVENTS_PER_REQUEST = 20;
const MAX_ID_LENGTH = 100;
const MAX_PATH_LENGTH = 300;

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sanitizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_ID_LENGTH);
  return trimmed || null;
}

function refererPath(request) {
  const ref = request.headers.get('Referer');
  if (!ref) return null;
  try {
    return new URL(ref).pathname.slice(0, MAX_PATH_LENGTH);
  } catch {
    return null;
  }
}

function sanitizeOne(raw, fallbackPath) {
  if (!raw || typeof raw !== 'object') return { error: 'Each event must be an object' };

  const type = raw.type;
  if (!ANALYTICS_EVENT_TYPES.includes(type)) {
    return { error: `Unknown event type "${type}"` };
  }

  const payloadCheck = validateEventPayload(type, raw.payload);
  if (!payloadCheck.valid) {
    return { error: `Invalid payload for "${type}": ${payloadCheck.error}` };
  }

  const path = sanitizeId(typeof raw.path === 'string' ? raw.path.slice(0, MAX_PATH_LENGTH) : null) || fallbackPath;

  return {
    type,
    payload: payloadCheck.payload,
    anonId: sanitizeId(raw.anonId),
    sessionId: sanitizeId(raw.sessionId),
    path,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const rawEvents = Array.isArray(body?.events) ? body.events : [body];
  if (rawEvents.length === 0) return jsonError('No events provided');
  if (rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    return jsonError(`Too many events in one request (max ${MAX_EVENTS_PER_REQUEST})`);
  }

  const fallbackPath = refererPath(request);

  const prepared = [];
  for (const raw of rawEvents) {
    const result = sanitizeOne(raw, fallbackPath);
    if (result.error) return jsonError(result.error);
    prepared.push(result);
  }

  const statements = prepared.map(ev =>
    env.DB.prepare(
      `INSERT INTO analytics_events (event_type, anon_id, session_id, payload, path) VALUES (?, ?, ?, ?, ?)`
    ).bind(ev.type, ev.anonId, ev.sessionId, JSON.stringify(ev.payload), ev.path)
  );

  try {
    if (statements.length === 1) {
      await statements[0].run();
    } else {
      await env.DB.batch(statements);
    }
  } catch {
    return jsonError('Could not record event(s)', 502);
  }

  return new Response(JSON.stringify({ ok: true, recorded: prepared.length }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
}