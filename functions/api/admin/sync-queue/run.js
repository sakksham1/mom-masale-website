// functions/api/admin/sync-queue/run.js
// POST /api/admin/sync-queue/run — admin-only. Publishes everything
// currently queued in site_sync_queue in one shot: a single
// syncProductsToGitHub() call (which rebuilds data/products.json from live
// D1 state — not incremental), then marks every queued row that was pending
// at the START of this run as synced against the resulting batch.
//
// Guarded by a simple compare-and-swap lock in site_sync_lock so two admins
// can't trigger overlapping publishes.

import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { syncProductsToGitHub } from '../../_utils/products-sync.js';
import { publishStagedContent } from '../../_utils/content-staging.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const claim = await env.DB.prepare(
    `UPDATE site_sync_lock SET syncing = 1, locked_by = ?, locked_at = datetime('now') WHERE id = 1 AND syncing = 0`
  ).bind(user.id).run();

  if (claim.meta.changes === 0) {
    return jsonError('A publish is already in progress. Please wait for it to finish.', 409);
  }

  try {
    const pending = await env.DB.prepare(
      `SELECT id FROM site_sync_queue WHERE status = 'pending' ORDER BY id ASC`
    ).all();
    const pendingIds = (pending.results || []).map(r => r.id);

    if (pendingIds.length === 0) {
      return new Response(JSON.stringify({
        ok: true, published: false, message: 'Nothing to publish — already up to date.',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const batchInsert = await env.DB.prepare(
      `INSERT INTO site_sync_batches (triggered_by, item_count, status) VALUES (?, ?, 'running')`
    ).bind(user.id, pendingIds.length).run();
    const batchId = batchInsert.meta.last_row_id;

    try {
      await syncProductsToGitHub(env, `chore(publish): sync ${pendingIds.length} pending change(s)`);
      await publishStagedContent(env, 'recipes', 'data/recipes.json', `chore(publish): sync recipes`);
      await publishStagedContent(env, 'blog', 'data/blog.json', `chore(publish): sync blog`);
      await publishStagedContent(env, 'settings', 'data/settings.json', `chore(publish): sync site settings`);
      await publishStagedContent(env, 'returnPolicy', 'data/return-policy.json', `chore(publish): sync return policy`);

      const placeholders = pendingIds.map(() => '?').join(',');
      await env.DB.prepare(
        `UPDATE site_sync_queue SET status = 'synced', synced_batch_id = ? WHERE id IN (${placeholders})`
      ).bind(batchId, ...pendingIds).run();

      await env.DB.prepare(
        `UPDATE site_sync_batches SET status = 'success', completed_at = datetime('now') WHERE id = ?`
      ).bind(batchId).run();

      await logAudit(env, {
        userId: user.id, action: 'publish', resource: 'site_sync_batch', resourceId: batchId,
        diff: { itemCount: pendingIds.length },
      });

      return new Response(JSON.stringify({
        ok: true, published: true, batchId, itemCount: pendingIds.length,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      await env.DB.prepare(
        `UPDATE site_sync_batches SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`
      ).bind(err.message, batchId).run();
      // Queue rows are left 'pending' — untouched — so the next publish
      // attempt retries them automatically. Nothing is lost.
      return jsonError(`Publish failed: ${err.message}`, 502);
    }
  } finally {
    await env.DB.prepare(
      `UPDATE site_sync_lock SET syncing = 0, locked_by = NULL, locked_at = NULL WHERE id = 1`
    ).run();
  }
}
