// functions/scheduled/backup.js
//
// ⚠️ WIRING CAVEAT — read before deploying:
// This project deploys as a Cloudflare Pages project using directory-based
// Functions routing (functions/api/**, no _worker.js). Cron Triggers are a
// Workers concept. Pages only invokes a `scheduled` handler if either:
//   (a) the project is switched to Pages "Advanced Mode" — a single
//       _worker.js that re-exports both the Pages asset/Functions router
//       AND `scheduled` from this file, or
//   (b) this logic runs in a small, separate Worker with its own
//       wrangler.toml binding the same D1 database_id (and same R2
//       bucket) as this project, deployed independently with its own
//       [triggers] cron config.
// Neither is set up yet. This file is written so either path can import
// `scheduled` directly — dropping it into functions/scheduled/ does NOT
// make Pages call it automatically. Flagging this rather than pretending
// the wrangler.toml cron block below "just works" with the current deploy
// shape — needs a decision (and a small follow-up) before this runs live.
//
// What it does, in one weekly run:
//   1. Long-term backup — dumps core tables as JSON to R2 under
//      backups/{timestamp}/{table}.json. D1 already has Time Travel
//      (automatic point-in-time recovery, 30-day window, restorable via
//      `wrangler d1 time-travel restore`) — this does NOT replace that.
//      It covers what Time Travel doesn't: retention past 30 days and an
//      off-D1 copy.
//   2. Prunes the tables that grow forever with no cleanup today.
//
// No restore tooling is built here by design — restoring from an R2 JSON
// dump is a manual, rare operation:
//
//   RESTORE PROCESS (manual):
//   1. wrangler r2 object get <bucket> backups/{timestamp}/{table}.json --file={table}.json
//      (repeat per table you actually need)
//   2. Inspect the JSON and decide what specifically needs restoring —
//      never a blind full-table overwrite, since D1 has moved on since
//      the dump was taken (new orders, new sessions, etc. would be lost).
//   3. Hand-write targeted INSERT/UPDATE statements (or a one-off script)
//      from the dumped rows via `wrangler d1 execute`. Don't bulk-reimport;
//      autoincrement ids and foreign keys will collide with rows created
//      since the backup.

const BACKUP_TABLES = [
  'products', 'product_sizes', 'product_aliases', 'product_faq', 'product_related',
  'orders', 'order_items',
  'raw_materials',
  'users',
  'site_coupons',
  'career_jobs', 'career_applications',
];

// Deliberately excluded from the long-term backup: analytics_events,
// audit_log, login_attempts, login_history, sessions, password_resets,
// notifications, push_tokens, product_stock_transactions,
// raw_material_transactions, packaging_reports, sales_reports,
// product_core_change_requests, coupon_change_requests, career_application_events,
// career_application_attempts, content_staging, site_sync_queue/batches/lock.
// Either high-volume/low long-term value, fully reconstructible from the
// tables above, or already covered by the prune job below. Revisit if any
// of these turn out to matter more than assumed here.

const PRUNE_JOBS = [
  { table: 'login_attempts', column: 'created_at', olderThanDays: 30 },
  { table: 'analytics_events', column: 'created_at', olderThanDays: 180 },
  { table: 'login_history', column: 'created_at', olderThanDays: 365 },
  { table: 'audit_log', column: 'created_at', olderThanDays: 365 },
];

async function runBackup(env) {
  if (!env.DB) return;
  // Prefer a dedicated bucket if one gets bound; fall back to the existing
  // IMAGES bucket under a backups/ prefix so this can ship without a new
  // wrangler.toml binding + `wrangler r2 bucket create` step blocking it.
  const bucket = env.BACKUPS || env.IMAGES;
  if (!bucket) {
    console.error('backup: no R2 bucket bound (expected env.BACKUPS or env.IMAGES) — skipping backup');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const table of BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      const rows = result.results || [];
      await bucket.put(
        `backups/${timestamp}/${table}.json`,
        JSON.stringify(rows),
        { httpMetadata: { contentType: 'application/json' } }
      );
    } catch (err) {
      // One table failing to dump shouldn't stop the rest — log and move on.
      console.error(`backup: failed to dump table "${table}":`, err.message);
    }
  }
}

async function runPrune(env) {
  if (!env.DB) return;
  for (const job of PRUNE_JOBS) {
    try {
      const result = await env.DB.prepare(
        `DELETE FROM ${job.table} WHERE ${job.column} < datetime('now', '-${job.olderThanDays} days')`
      ).run();
      console.log(`prune: ${job.table} — removed ${result.meta.changes} row(s) older than ${job.olderThanDays}d`);
    } catch (err) {
      console.error(`prune: failed on table "${job.table}":`, err.message);
    }
  }
}

export async function scheduled(event, env, ctx) {
  ctx.waitUntil(Promise.all([runBackup(env), runPrune(env)]));
}

// Convenience default export for a possible Advanced Mode _worker.js entry
// point, e.g.: `export { scheduled } from './functions/scheduled/backup.js';`
export default { scheduled };
