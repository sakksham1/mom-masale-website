// functions/api/admin/blog/tables.js
// POST   /api/admin/blog/tables    { slug, table }              — append
// PATCH  /api/admin/blog/tables    { slug, index, table }       — replace one
// DELETE /api/admin/blog/tables?slug=...&index=...              — remove one
import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { readStagedOrLive, stageContent } from '../../_utils/content-staging.js';
import { enqueueSync } from '../../_utils/sync-queue.js';

const BLOG_PATH = 'data/blog.json';

function validTable(t) {
  return t && Array.isArray(t.headers) && t.headers.length &&
    Array.isArray(t.rows) && t.rows.every(row => Array.isArray(row) && row.length === t.headers.length);
}

async function loadBlogPosts(env) {
  const { content } = await readStagedOrLive(env, 'blog', BLOG_PATH);
  return JSON.parse(content);
}
async function save(env, posts, user, summary) {
  const newContent = JSON.stringify(posts, null, 2) + '\n';
  await stageContent(env, 'blog', newContent, user.id);
  await enqueueSync(env, { sourceType: 'blog', sourceId: null, productSlug: null, summary, createdBy: user.id });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  if (!body.slug) return jsonError('slug is required');
  if (!validTable(body.table)) return jsonError('table must have headers[] and matching rows[]');

  const posts = await loadBlogPosts(env);
  const idx = posts.findIndex(b => b.slug === body.slug);
  if (idx === -1) return jsonError('Blog post not found', 404);

  posts[idx].tables = posts[idx].tables || [];
  posts[idx].tables.push(body.table);
  await save(env, posts, user, `Table added to blog post "${body.slug}"`);
  await logAudit(env, { userId: user.id, action: 'create', resource: 'blog_table', resourceId: body.slug });

  return new Response(JSON.stringify({ ok: true, tables: posts[idx].tables, status: 'pending_publish' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  if (!body.slug || !Number.isInteger(body.index)) return jsonError('slug and index are required');
  if (!validTable(body.table)) return jsonError('table must have headers[] and matching rows[]');

  const posts = await loadBlogPosts(env);
  const idx = posts.findIndex(b => b.slug === body.slug);
  if (idx === -1) return jsonError('Blog post not found', 404);
  const tables = posts[idx].tables || [];
  if (!tables[body.index]) return jsonError('Table index out of range', 404);

  tables[body.index] = body.table;
  posts[idx].tables = tables;
  await save(env, posts, user, `Table updated on blog post "${body.slug}"`);
  await logAudit(env, { userId: user.id, action: 'update', resource: 'blog_table', resourceId: body.slug });

  return new Response(JSON.stringify({ ok: true, tables, status: 'pending_publish' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  const index = Number(url.searchParams.get('index'));
  if (!slug || !Number.isInteger(index)) return jsonError('slug and index query params are required');

  const posts = await loadBlogPosts(env);
  const idx = posts.findIndex(b => b.slug === slug);
  if (idx === -1) return jsonError('Blog post not found', 404);
  const tables = posts[idx].tables || [];
  if (!tables[index]) return jsonError('Table index out of range', 404);

  tables.splice(index, 1);
  posts[idx].tables = tables;
  await save(env, posts, user, `Table removed from blog post "${slug}"`);
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'blog_table', resourceId: slug });

  return new Response(JSON.stringify({ ok: true, tables, status: 'pending_publish' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}