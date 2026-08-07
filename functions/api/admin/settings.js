// functions/api/admin/settings.js
import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';
import { readRepoFile } from '../_utils/github.js';
import { readStagedOrLive, stageContent } from '../_utils/content-staging.js';
import { enqueueSync } from '../_utils/sync-queue.js';

const SETTINGS_PATH = 'data/settings.json';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  try {
    const { content } = await readStagedOrLive(env, 'settings', SETTINGS_PATH);
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let updates;
  try { updates = await request.json(); } catch { return jsonError('Invalid request body'); }

  try {
    const { content } = await readStagedOrLive(env, 'settings', SETTINGS_PATH);
    const settings = JSON.parse(content);
    const merged = { ...settings, ...updates,
      business: { ...settings.business, ...(updates.business || {}) },
      commerce: { ...settings.commerce, ...(updates.commerce || {}) },
    };
    const newContent = JSON.stringify(merged, null, 2) + '\n';
    await stageContent(env, 'settings', newContent, user.id);
    await enqueueSync(env, {
      sourceType: 'settings', sourceId: null, productSlug: null,
      summary: 'Site settings updated (shipping/pricing/business info)',
      createdBy: user.id,
    });
    return new Response(JSON.stringify({ ok: true, settings: merged, status: 'pending_publish' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}