// functions/api/admin/upload.js
// POST /api/admin/upload   multipart/form-data: { file, folder?, filename? }
//
// folder in {products, recipes, blog, events} -> committed straight to
// GitHub at images/{folder}/{filename}.{ext}. These paths are what
// build-site.js/templates/data JSON reference as real static files — R2 was
// never wired into that path, so anything uploaded there previously 404'd
// on the live site until someone manually re-committed it.
//
// Everything else (reviews-adjacent misc uploads, generic admin
// attachments) stays in R2, served live via /api/images/*.

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';
import { readRepoFileBinary, writeRepoBinaryFile } from '../_utils/github.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const CONTENT_IMAGE_FOLDERS = new Set(['products', 'recipes', 'blog', 'events']);

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let form;
  try { form = await request.formData(); } catch { return jsonError('Expected multipart/form-data'); }

  const file = form.get('file');
  const folder = sanitizeName(String(form.get('folder') || 'uploads'));
  // Optional explicit target name (no extension) — e.g. a recipe's slug, or
  // "{slug}-2" / "{slug}-3" for extra gallery images. Falls back to the
  // uploaded file's own name if omitted.
  const requestedName = form.get('filename')
    ? sanitizeName(String(form.get('filename')).replace(/\.[a-z0-9]+$/i, ''))
    : null;

  if (!file || typeof file === 'string') return jsonError('file is required');
  if (!ALLOWED_TYPES.has(file.type)) return jsonError('Only webp, jpeg, or png allowed');
  if (file.size > MAX_BYTES) return jsonError('File too large (max 5MB)');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';

  if (CONTENT_IMAGE_FOLDERS.has(folder)) {
    const base = requestedName || sanitizeName(file.name.replace(/\.[a-z0-9]+$/i, '')) || `image-${Date.now()}`;
    const repoPath = `images/${folder}/${base}.${ext}`;

    let sha;
    try {
      const existing = await readRepoFileBinary(env, repoPath);
      sha = existing?.sha;
    } catch (err) {
      return jsonError(`Could not check the repo for an existing file: ${err.message}`, 502);
    }

    try {
      await writeRepoBinaryFile(
        env, repoPath, await file.arrayBuffer(),
        `chore(images): ${sha ? 'update' : 'add'} ${repoPath}`, sha
      );
    } catch (err) {
      return jsonError(`Could not commit image to the repo: ${err.message}`, 502);
    }

    return new Response(JSON.stringify({
      ok: true,
      path: repoPath,
      committedToRepo: true,
      note: 'Committed to GitHub — will appear on the live site once the current build finishes (usually a minute or two).',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  // ── everything else: unchanged R2 behavior ──
  if (!env.IMAGES) return jsonError('R2 bucket not configured for this environment', 502);
  const base = requestedName || sanitizeName(file.name.replace(/\.[a-z0-9]+$/i, '')) || 'image';
  const key = `${folder}/${Date.now()}-${base}.${ext}`;

  await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  return new Response(JSON.stringify({ ok: true, path: `images/${key}`, url: `/api/images/${key}` }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}