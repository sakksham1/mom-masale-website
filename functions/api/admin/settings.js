// functions/api/admin/settings.js
import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';
import { readRepoFile, writeRepoFile } from '../_utils/github.js';

const SETTINGS_PATH = 'data/settings.json';

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  try {
    const { content } = await readRepoFile(env, SETTINGS_PATH);
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let updates;
  try { updates = await request.json(); } catch { return jsonError('Invalid request body'); }

  try {
    const { content, sha } = await readRepoFile(env, SETTINGS_PATH);
    const settings = JSON.parse(content);
    const merged = { ...settings, ...updates,
      business: { ...settings.business, ...(updates.business || {}) },
      commerce: { ...settings.commerce, ...(updates.commerce || {}) },
    };
    const newContent = JSON.stringify(merged, null, 2) + '\n';
    await writeRepoFile(env, SETTINGS_PATH, newContent, sha, 'chore(admin): update site settings');
    return new Response(JSON.stringify({ ok: true, settings: merged }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}