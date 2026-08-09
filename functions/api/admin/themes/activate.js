// functions/api/admin/themes/activate.js
// POST /api/admin/themes/activate   { id }   — activates one theme, deactivates
//   all others, and syncs every coupon's is_active to match its theme link:
//   coupons linked to the newly active theme turn ON, coupons linked to
//   whichever theme was previously active turn OFF. Coupons with no
//   theme_id (vanilla coupons) are never touched here.
// POST /api/admin/themes/deactivate { }      — reverts to the default site
//   look and turns off only the coupons linked to the theme that was active.

import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const isDeactivate = url.pathname.endsWith('/deactivate');

  const previouslyActive = await env.DB.prepare(
    `SELECT id, key FROM site_themes WHERE is_active = 1`
  ).first();

  if (isDeactivate) {
    const statements = [
      env.DB.prepare(`UPDATE site_themes SET is_active = 0 WHERE is_active = 1`),
    ];
    if (previouslyActive) {
      statements.push(
        env.DB.prepare(
          `UPDATE site_coupons SET is_active = 0, updated_at = datetime('now') WHERE theme_id = ?`
        ).bind(previouslyActive.id)
      );
    }
    await env.DB.batch(statements);

    await logAudit(env, {
      userId: user.id, action: 'deactivate', resource: 'site_theme',
      resourceId: previouslyActive ? previouslyActive.key : null,
    });

    return new Response(JSON.stringify({ ok: true, active: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { id } = body;
  if (!Number.isInteger(id)) return jsonError('id is required');

  const theme = await env.DB.prepare('SELECT id, key FROM site_themes WHERE id = ?').bind(id).first();
  if (!theme) return jsonError('Theme not found', 404);

  const statements = [];
  // Turn off the outgoing theme's linked coupons FIRST (while it's still
  // flagged active, so we know which row that was) — matters when
  // switching directly from Theme A to Theme B without an explicit
  // deactivate step in between.
  if (previouslyActive && previouslyActive.id !== id) {
    statements.push(
      env.DB.prepare(
        `UPDATE site_coupons SET is_active = 0, updated_at = datetime('now') WHERE theme_id = ?`
      ).bind(previouslyActive.id)
    );
  }
  statements.push(
    env.DB.prepare(`UPDATE site_themes SET is_active = 0 WHERE is_active = 1`),
    env.DB.prepare(
      `UPDATE site_themes SET is_active = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
    ).bind(user.id, id),
    // Turn on the incoming theme's linked coupons.
    env.DB.prepare(
      `UPDATE site_coupons SET is_active = 1, updated_at = datetime('now') WHERE theme_id = ?`
    ).bind(id)
  );

  await env.DB.batch(statements);

  await logAudit(env, { userId: user.id, action: 'activate', resource: 'site_theme', resourceId: theme.key });

  return new Response(JSON.stringify({ ok: true, active: theme.key }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}