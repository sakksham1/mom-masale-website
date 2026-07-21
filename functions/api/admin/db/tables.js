// GET /api/admin/db/tables — lists user tables with their columns, for the
// read-only DB Explorer. Admin only.

import { requireAdmin, forbidden, jsonError } from '../../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  try {
    const tablesResult = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
    ).all();

    const tables = [];
    for (const row of tablesResult.results || []) {
      // row.name comes from our own sqlite_master query, not user input, so
      // interpolating it into PRAGMA (which can't take bound params) is safe.
      const columnsResult = await env.DB.prepare(`PRAGMA table_info(${row.name})`).all();
      tables.push({
        name: row.name,
        columns: (columnsResult.results || []).map(c => ({
          name: c.name,
          type: c.type,
          notNull: !!c.notnull,
          primaryKey: !!c.pk,
        })),
      });
    }

    return new Response(JSON.stringify({ tables }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(`Could not list tables: ${err.message}`, 502);
  }
}