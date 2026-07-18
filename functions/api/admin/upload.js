// functions/api/admin/upload.js
// POST /api/admin/upload   multipart/form-data: { file, folder? }
// Admin-only. Uploads to R2, returns a path servable via /api/images/*.
// folder defaults to "uploads" — pass "products" | "recipes" | "blog" | "events" etc.

import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  if (!env.IMAGES) return jsonError('R2 bucket not configured for this environment', 502);

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonError('Expected multipart/form-data');
  }

  const file = form.get('file');
  const folder = sanitizeName(String(form.get('folder') || 'uploads'));
  if (!file || typeof file === 'string') return jsonError('file is required');
  if (!ALLOWED_TYPES.has(file.type)) return jsonError('Only webp, jpeg, or png allowed');
  if (file.size > MAX_BYTES) return jsonError('File too large (max 5MB)');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
  const base = sanitizeName(file.name.replace(/\.[a-z0-9]+$/i, '')) || 'image';
  const key = `${folder}/${Date.now()}-${base}.${ext}`;

  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  return new Response(JSON.stringify({ ok: true, path: `images/${key}`, url: `/api/images/${key}` }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}