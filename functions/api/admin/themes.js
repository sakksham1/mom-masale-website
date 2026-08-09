// functions/api/admin/themes.js
// GET    /api/admin/themes            — list all themes (admin + manager)
// POST   /api/admin/themes            — create a theme
// PATCH  /api/admin/themes            { id, updates }
// DELETE /api/admin/themes?id=...     — refuses to delete the active theme

import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';

const EDITABLE_FIELDS = {
  key: 'key', name: 'name',
  colors: 'colors',
  featuredSectionTitle: 'featured_section_title',
  promoBannerText: 'promo_banner_text',
  heroTitle: 'hero_title', heroCtaLabel: 'hero_cta_label', heroCtaUrl: 'hero_cta_url', heroImage: 'hero_image',
  bannerEnabled: 'banner_enabled', bannerTitle: 'banner_title', bannerBody: 'banner_body',
  bannerImage: 'banner_image', bannerCtaLabel: 'banner_cta_label', bannerCtaUrl: 'banner_cta_url',
  discountPercent: 'discount_percent', couponCode: 'coupon_code',
  startsAt: 'starts_at', endsAt: 'ends_at',
};

function slugify(v) {
  return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function rowToJson(row) {
  return {
    id: row.id, key: row.key, name: row.name, isActive: !!row.is_active,
    colors: row.colors ? JSON.parse(row.colors) : {},
    featuredSectionTitle: row.featured_section_title,
    promoBannerText: row.promo_banner_text,
    heroTitle: row.hero_title, heroCtaLabel: row.hero_cta_label, heroCtaUrl: row.hero_cta_url, heroImage: row.hero_image,
    bannerEnabled: !!row.banner_enabled, bannerTitle: row.banner_title, bannerBody: row.banner_body,
    bannerImage: row.banner_image, bannerCtaLabel: row.banner_cta_label, bannerCtaUrl: row.banner_cta_url,
    discountPercent: row.discount_percent, couponCode: row.coupon_code,
    startsAt: row.starts_at, endsAt: row.ends_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const result = await env.DB.prepare(`SELECT * FROM site_themes ORDER BY is_active DESC, name`).all();
  return new Response(JSON.stringify({ themes: (result.results || []).map(rowToJson) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const name = (body.name || '').trim();
  if (!name) return jsonError('name is required');
  const key = slugify(body.key || name);
  if (!key) return jsonError('Could not derive a valid key from that name');

  const existing = await env.DB.prepare('SELECT id FROM site_themes WHERE key = ?').bind(key).first();
  if (existing) return jsonError(`A theme with key "${key}" already exists`, 409);

  if (body.colors && typeof body.colors !== 'object') return jsonError('colors must be an object');
  if (body.discountPercent != null && (!Number.isInteger(body.discountPercent) || body.discountPercent < 0 || body.discountPercent > 90)) {
    return jsonError('discountPercent must be an integer between 0 and 90');
  }

  const result = await env.DB.prepare(
    `INSERT INTO site_themes
       (key, name, colors, featured_section_title, promo_banner_text,
        hero_title, hero_cta_label, hero_cta_url, hero_image,
        banner_enabled, banner_title, banner_body, banner_image, banner_cta_label, banner_cta_url,
        discount_percent, coupon_code, starts_at, ends_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    key, name, JSON.stringify(body.colors || {}),
    body.featuredSectionTitle || null, body.promoBannerText || null,
    body.heroTitle || null, body.heroCtaLabel || null, body.heroCtaUrl || null, body.heroImage || null,
    body.bannerEnabled ? 1 : 0, body.bannerTitle || null, body.bannerBody || null,
    body.bannerImage || null, body.bannerCtaLabel || null, body.bannerCtaUrl || null,
    Number.isInteger(body.discountPercent) ? body.discountPercent : null, body.couponCode || null,
    body.startsAt || null, body.endsAt || null, user.id, user.id
  ).run();

  await logAudit(env, { userId: user.id, action: 'create', resource: 'site_theme', resourceId: key, diff: { name } });

  const row = await env.DB.prepare('SELECT * FROM site_themes WHERE id = ?').bind(result.meta.last_row_id).first();
  return new Response(JSON.stringify({ ok: true, theme: rowToJson(row) }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { id, updates } = body;
  if (!Number.isInteger(id)) return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const existing = await env.DB.prepare('SELECT id FROM site_themes WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Theme not found', 404);

  if ('discountPercent' in updates && updates.discountPercent != null &&
      (!Number.isInteger(updates.discountPercent) || updates.discountPercent < 0 || updates.discountPercent > 90)) {
    return jsonError('discountPercent must be an integer between 0 and 90');
  }

  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
    if (!(key in updates)) continue;
    const val = updates[key];
    sets.push(`${column} = ?`);
    if (key === 'colors') binds.push(JSON.stringify(val || {}));
    else if (key === 'bannerEnabled') binds.push(val ? 1 : 0);
    else if (key === 'key') binds.push(slugify(val));
    else binds.push(val ?? null);
  }
  if (!sets.length) return jsonError('No editable fields provided');

  sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
  binds.push(user.id, id);

  try {
    await env.DB.prepare(`UPDATE site_themes SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return jsonError('That key is already in use by another theme', 409);
    throw err;
  }

  await logAudit(env, { userId: user.id, action: 'update', resource: 'site_theme', resourceId: id, diff: updates });

  const row = await env.DB.prepare('SELECT * FROM site_themes WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ ok: true, theme: rowToJson(row) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return jsonError('id query param is required');

  const row = await env.DB.prepare('SELECT id, key, is_active FROM site_themes WHERE id = ?').bind(id).first();
  if (!row) return jsonError('Theme not found', 404);
  if (row.is_active) return jsonError('Deactivate this theme before deleting it', 409);

  await env.DB.prepare('DELETE FROM site_themes WHERE id = ?').bind(id).run();
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'site_theme', resourceId: row.key });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}