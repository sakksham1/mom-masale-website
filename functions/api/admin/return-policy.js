// functions/api/admin/return-policy.js
// GET   /api/admin/return-policy   — current (staged-or-live) return policy JSON, admin only
// PATCH /api/admin/return-policy   { intro?, sections?, contact? } — merges into staged content
//
// Mirrors admin/settings.js exactly: data/return-policy.json is GitHub-JSON
// (not D1), edits are staged via content-staging.js and only actually
// committed to GitHub — which is what puts it live and triggers a Pages
// deploy — when an admin runs POST /api/admin/sync-queue/run. See that
// file for the publishStagedContent() call that ships this source_type.
//
// `sections` is a full-array replace when provided (same convention the
// Flutter admin app should use: fetch current via GET, edit the array
// client-side, PATCH the whole thing back) — there's no per-section
// add/remove endpoint, keeping this file small and matching how `contact`
// is handled below (shallow-merged instead).

import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';
import { readStagedOrLive, stageContent } from '../_utils/content-staging.js';
import { enqueueSync } from '../_utils/sync-queue.js';

const RETURN_POLICY_PATH = 'data/return-policy.json';
const SOURCE_TYPE = 'returnPolicy';

function validateSections(sections) {
  if (!Array.isArray(sections)) return 'sections must be an array';
  const seenIds = new Set();
  for (const s of sections) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return 'Each section must be an object';
    if (!s.id || typeof s.id !== 'string') return 'Each section needs a non-empty string "id"';
    if (seenIds.has(s.id)) return `Duplicate section id: "${s.id}"`;
    seenIds.add(s.id);
    if (!s.title || typeof s.title !== 'string') return `Section "${s.id}" needs a non-empty "title"`;
    if ('body' in s && (!Array.isArray(s.body) || s.body.some(p => typeof p !== 'string'))) {
      return `Section "${s.id}": body must be an array of paragraph strings`;
    }
    if ('list' in s && (!Array.isArray(s.list) || s.list.some(li => typeof li !== 'string'))) {
      return `Section "${s.id}": list must be an array of strings`;
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  try {
    const { content } = await readStagedOrLive(env, SOURCE_TYPE, RETURN_POLICY_PATH);
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

  if ('intro' in updates && typeof updates.intro !== 'string') {
    return jsonError('intro must be a string');
  }
  if ('sections' in updates) {
    const sectionsError = validateSections(updates.sections);
    if (sectionsError) return jsonError(sectionsError);
  }
  if ('contact' in updates && (typeof updates.contact !== 'object' || Array.isArray(updates.contact) || updates.contact === null)) {
    return jsonError('contact must be an object');
  }

  try {
    const { content } = await readStagedOrLive(env, SOURCE_TYPE, RETURN_POLICY_PATH);
    const current = JSON.parse(content);

    const merged = {
      ...current,
      ...updates,
      contact: { ...current.contact, ...(updates.contact || {}) },
      lastUpdated: new Date().toISOString().slice(0, 10),
    };

    const newContent = JSON.stringify(merged, null, 2) + '\n';
    await stageContent(env, SOURCE_TYPE, newContent, user.id);
    await enqueueSync(env, {
      sourceType: 'return_policy',
      sourceId: null,
      productSlug: null,
      summary: 'Return policy updated',
      createdBy: user.id,
    });

    return new Response(JSON.stringify({ ok: true, returnPolicy: merged, status: 'pending_publish' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}
