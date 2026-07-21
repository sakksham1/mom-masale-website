// POST /api/admin/db/query   { sql, limit? }
//
// Read-only ad-hoc query executor for the admin DB Explorer.
//
// Every query is wrapped as a subquery — SELECT * FROM (<user sql>) LIMIT n —
// which does double duty: it caps row count AND makes statement-stacking
// (';' + a second statement) fail as invalid SQL on its own, since a
// subquery can't contain more than one statement. The keyword blocklist
// below is a second, independent layer of defense in case that wrapping
// trick is ever bypassed by a parsing quirk.

import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

const BANNED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE',
  'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'TRIGGER', 'GRANT',
  'TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
];

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const rawSql = (body.sql || '').trim();
  if (!rawSql) return jsonError('sql is required');

  // Strip one trailing semicolon (common habit), then reject any remaining
  // semicolon — that's statement stacking.
  const sql = rawSql.replace(/;\s*$/, '');
  if (sql.includes(';')) {
    return jsonError('Only a single statement is allowed — remove the semicolon(s)');
  }

  const firstWord = sql.match(/^\s*(\w+)/)?.[1]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return jsonError('Only SELECT queries are allowed');
  }

  for (const keyword of BANNED_KEYWORDS) {
    const re = new RegExp(`\\b${keyword}\\b`, 'i');
    if (re.test(sql)) {
      return jsonError(`Query contains disallowed keyword: ${keyword}`);
    }
  }

  const requestedLimit = Number.isInteger(body.limit) ? body.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

  const wrapped = `SELECT * FROM (${sql}) AS db_explorer_query LIMIT ${limit}`;

  const startedAt = Date.now();
  try {
    const result = await env.DB.prepare(wrapped).all();
    const rows = result.results || [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    await logAudit(env, {
      userId: user.id, action: 'db_query', resource: 'db_explorer', resourceId: null,
      diff: { sql, rowCount: rows.length, ms: Date.now() - startedAt },
    });

    return new Response(JSON.stringify({
      columns, rows, rowCount: rows.length, truncated: rows.length === limit,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(`Query failed: ${err.message}`, 400);
  }
}