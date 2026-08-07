import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const claim = await env.DB.prepare(
    `UPDATE site_sync_lock SET syncing = 1, locked_by = ?, locked_at = datetime('now') WHERE id = 1 AND syncing = 0`
  ).bind(user.id).run();

  if (claim.meta.changes === 0) {
    return jsonError('A publish is currently in progress. Please wait for it to finish.', 409);
  }

  try {
    const pending = await env.DB.prepare(
      `SELECT id FROM site_sync_queue WHERE status = 'pending'`
    ).all();
    const pendingIds = (pending.results || []).map(r => r.id);

    if (pendingIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, discarded: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const placeholders = pendingIds.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM site_sync_queue WHERE id IN (${placeholders})`)
      .bind(...pendingIds).run();

    await env.DB.prepare(
      `DELETE FROM content_staging WHERE source_type IN ('recipes','blog','settings')`
    ).run();

    await logAudit(env, {
      userId: user.id, action: 'discard', resource: 'site_sync_queue', resourceId: null,
      diff: { itemCount: pendingIds.length },
    });

    return new Response(JSON.stringify({ ok: true, discarded: pendingIds.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await env.DB.prepare(
      `UPDATE site_sync_lock SET syncing = 0, locked_by = NULL, locked_at = NULL WHERE id = 1`
    ).run();
  }
}