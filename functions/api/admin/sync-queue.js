// functions/api/admin/sync-queue.js
// GET /api/admin/sync-queue — admin-only. Lists pending publish-queue items
// (oldest first) plus the most recent publish batch, for the Publish Queue screen.

import { requireAdmin, forbidden } from '../_utils/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const pendingResult = await env.DB.prepare(
    `SELECT q.id, q.source_type, q.source_id, q.product_slug, q.summary, q.created_at,
            u.name as created_by_name
     FROM site_sync_queue q
     LEFT JOIN users u ON u.id = q.created_by
     WHERE q.status = 'pending'
     ORDER BY q.created_at ASC`
  ).all();

  const pendingCountRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM site_sync_queue WHERE status = 'pending'`
  ).first();

  const lastBatch = await env.DB.prepare(
    `SELECT b.id, b.item_count, b.status, b.error_message, b.started_at, b.completed_at,
            u.name as triggered_by_name
     FROM site_sync_batches b
     LEFT JOIN users u ON u.id = b.triggered_by
     ORDER BY b.id DESC LIMIT 1`
  ).first();

  return new Response(JSON.stringify({
    pending: pendingResult.results || [],
    pendingCount: pendingCountRow?.c || 0,
    lastBatch: lastBatch || null,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}