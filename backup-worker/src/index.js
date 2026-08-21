// backup-worker/src/index.js
//
// Standalone Worker whose only job is the weekly cron: dump core tables to
// R2 for long-term retention, and prune the tables that grow forever with
// no cleanup in the main site. This exists as its own deployable Worker
// (separate from the mom-masale-website Pages project) because Cloudflare
// Pages in directory-Functions mode doesn't invoke `scheduled()` handlers —
// see the setup notes at the bottom of this file for the full reasoning
// and deploy steps.
//
// D1 already has Time Travel (automatic point-in-time recovery, 30-day
// window, `wrangler d1 time-travel restore`) — this does NOT replace that.
// It covers what Time Travel doesn't: retention past 30 days and an
// off-D1 copy.
//
// No restore tooling is built here by design — restoring from an R2 JSON
// dump is a manual, rare operation:
//
//   RESTORE PROCESS (manual):
//   1. wrangler r2 object get mom-masale-backups backups/{timestamp}/{table}.json --file={table}.json
//      (repeat per table you actually need — run from this worker's directory,
//      or anywhere with wrangler configured against the same account)
//   2. Inspect the JSON and decide what specifically needs restoring — never
//      a blind full-table overwrite, since D1 has moved on since the dump
//      was taken (new orders, new sessions, etc. would be lost by overwriting).
//   3. Hand-write targeted INSERT/UPDATE statements (or a one-off script)
//      from the dumped rows via `wrangler d1 execute --remote`. Don't
//      bulk-reimport; autoincrement ids and foreign keys will collide with
//      rows created since the backup.

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
// product_core_change_requests, coupon_change_requests,
// career_application_events, career_application_attempts, content_staging,
// site_sync_queue/batches/lock. Either high-volume/low long-term value,
// fully reconstructible from the tables above, or already handled by the
// prune job below. Revisit if any of these turn out to matter more than
// assumed here.

const PRUNE_JOBS = [
  { table: 'login_attempts', column: 'created_at', olderThanDays: 30 },
  { table: 'analytics_events', column: 'created_at', olderThanDays: 180 },
  { table: 'login_history', column: 'created_at', olderThanDays: 365 },
  { table: 'audit_log', column: 'created_at', olderThanDays: 365 },
];

async function runBackup(env) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  for (const table of BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      const rows = result.results || [];
      await env.BACKUPS.put(
        `backups/${timestamp}/${table}.json`,
        JSON.stringify(rows),
        { httpMetadata: { contentType: 'application/json' } }
      );
      results.push(`${table}: ${rows.length} row(s)`);
    } catch (err) {
      // One table failing to dump shouldn't stop the rest — log and move on.
      console.error(`backup: failed to dump table "${table}":`, err.message);
      results.push(`${table}: FAILED — ${err.message}`);
    }
  }
  console.log(`backup: wrote backups/${timestamp}/ —`, results.join(', '));
}

async function runPrune(env) {
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([runBackup(env), runPrune(env)]));
  },

  // Lets you sanity-check bindings by visiting the Worker's URL directly —
  // NOT how the cron actually fires (that's the `scheduled` export above),
  // just a convenience so you can confirm DB/BACKUPS are wired without
  // waiting for Sunday 3am or reaching for wrangler's --test-scheduled flag.
  async fetch(request, env, ctx) {
    if (!env.DB || !env.BACKUPS) {
      return new Response('Missing bindings — check wrangler.toml (DB, BACKUPS)', { status: 500 });
    }
    return new Response(
      'mom-masale-backup-worker is deployed and bindings look present.\n' +
      'This endpoint does not run the backup — that only happens on the cron schedule,\n' +
      'or via `wrangler dev --test-scheduled` / the dashboard "Trigger Cron" button.',
      { status: 200 }
    );
  },
};
