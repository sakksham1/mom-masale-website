// functions/api/admin/recipes/tables.js
// POST   /api/admin/recipes/tables    { slug, table }              — append
// PATCH  /api/admin/recipes/tables    { slug, index, table }       — replace one
// DELETE /api/admin/recipes/tables?slug=...&index=...              — remove one
import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { readStagedOrLive, stageContent } from '../../_utils/content-staging.js';
import { enqueueSync } from '../../_utils/sync-queue.js';

const RECIPES_PATH = 'data/recipes.json';

function validTable(t) {
  return t && Array.isArray(t.headers) && t.headers.length &&
    Array.isArray(t.rows) && t.rows.every(row => Array.isArray(row) && row.length === t.headers.length);
}

async function loadRecipes(env) {
  const { content } = await readStagedOrLive(env, 'recipes', RECIPES_PATH);
  return JSON.parse(content);
}
async function save(env, recipes, user, summary) {
  const newContent = JSON.stringify(recipes, null, 2) + '\n';
  await stageContent(env, 'recipes', newContent, user.id);
  await enqueueSync(env, { sourceType: 'recipe', sourceId: null, productSlug: null, summary, createdBy: user.id });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  if (!body.slug) return jsonError('slug is required');
  if (!validTable(body.table)) return jsonError('table must have headers[] and matching rows[]');

  const recipes = await loadRecipes(env);
  const idx = recipes.findIndex(r => r.slug === body.slug);
  if (idx === -1) return jsonError('Recipe not found', 404);

  recipes[idx].tables = recipes[idx].tables || [];
  recipes[idx].tables.push(body.table);
  await save(env, recipes, user, `Table added to recipe "${body.slug}"`);
  await logAudit(env, { userId: user.id, action: 'create', resource: 'recipe_table', resourceId: body.slug });

  return new Response(JSON.stringify({ ok: true, tables: recipes[idx].tables, status: 'pending_publish' }), {
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

  const recipes = await loadRecipes(env);
  const idx = recipes.findIndex(r => r.slug === body.slug);
  if (idx === -1) return jsonError('Recipe not found', 404);
  const tables = recipes[idx].tables || [];
  if (!tables[body.index]) return jsonError('Table index out of range', 404);

  tables[body.index] = body.table;
  recipes[idx].tables = tables;
  await save(env, recipes, user, `Table updated on recipe "${body.slug}"`);
  await logAudit(env, { userId: user.id, action: 'update', resource: 'recipe_table', resourceId: body.slug });

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

  const recipes = await loadRecipes(env);
  const idx = recipes.findIndex(r => r.slug === slug);
  if (idx === -1) return jsonError('Recipe not found', 404);
  const tables = recipes[idx].tables || [];
  if (!tables[index]) return jsonError('Table index out of range', 404);

  tables.splice(index, 1);
  recipes[idx].tables = tables;
  await save(env, recipes, user, `Table removed from recipe "${slug}"`);
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'recipe_table', resourceId: slug });

  return new Response(JSON.stringify({ ok: true, tables, status: 'pending_publish' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}