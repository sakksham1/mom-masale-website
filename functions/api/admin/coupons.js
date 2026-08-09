// functions/api/admin/coupons.js
// GET    /api/admin/coupons                — list all coupons (admin + manager)
// POST   /api/admin/coupons                — create a coupon
// PATCH  /api/admin/coupons                { id, updates }
// DELETE /api/admin/coupons?id=...         — hard-delete only if never redeemed;
//                                             otherwise deactivate via PATCH instead

import { requireRole, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { normalizeCode } from '../_utils/coupons.js';

const TYPES = ['percent', 'flat'];

const EDITABLE_FIELDS = {
  description: 'description',
  type: 'type',
  value: 'value',
  maxDiscountAmount: 'max_discount_amount',
  minSubtotal: 'min_subtotal',
  usageLimit: 'usage_limit',
  perUserLimit: 'per_user_limit',
  isActive: 'is_active',
  themeId: 'theme_id',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
};

function rowToJson(row) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.type,
    value: row.value,
    maxDiscountAmount: row.max_discount_amount,
    minSubtotal: row.min_subtotal,
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    perUserLimit: row.per_user_limit,
    isActive: !!row.is_active,
    themeId: row.theme_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Shared validation for both create and update. `partial` = true for PATCH,
// where only the fields actually present in `updates` need checking.
function validateCouponFields(input, { partial = false } = {}) {
  if (!partial || 'type' in input) {
    if (!TYPES.includes(input.type)) return `type must be one of: ${TYPES.join(', ')}`;
  }
  if (!partial || 'value' in input) {
    const type = input.type; // caller ensures type is resolved before calling when partial
    if (!Number.isInteger(input.value) || input.value <= 0) return 'value must be a positive integer';
    if (type === 'percent' && input.value > 90) return 'percent value cannot exceed 90';
  }
  if ('maxDiscountAmount' in input && input.maxDiscountAmount != null) {
    if (!Number.isInteger(input.maxDiscountAmount) || input.maxDiscountAmount <= 0) {
      return 'maxDiscountAmount must be a positive integer';
    }
  }
  if ('minSubtotal' in input && input.minSubtotal != null) {
    if (!Number.isInteger(input.minSubtotal) || input.minSubtotal < 0) return 'minSubtotal must be a non-negative integer';
  }
  if ('usageLimit' in input && input.usageLimit != null) {
    if (!Number.isInteger(input.usageLimit) || input.usageLimit <= 0) return 'usageLimit must be a positive integer';
  }
  if ('perUserLimit' in input && input.perUserLimit != null) {
    if (!Number.isInteger(input.perUserLimit) || input.perUserLimit <= 0) return 'perUserLimit must be a positive integer';
  }
  if ('startsAt' in input && input.startsAt && isNaN(Date.parse(input.startsAt))) return 'startsAt is not a valid date';
  if ('endsAt' in input && input.endsAt && isNaN(Date.parse(input.endsAt))) return 'endsAt is not a valid date';
  if (input.startsAt && input.endsAt && new Date(input.startsAt) >= new Date(input.endsAt)) {
    return 'endsAt must be after startsAt';
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ['admin', 'manager']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const activeOnly = url.searchParams.get('active') === '1';

  let query = `SELECT * FROM site_coupons`;
  if (activeOnly) query += ` WHERE is_active = 1`;
  query += ` ORDER BY created_at DESC`;

  const result = await env.DB.prepare(query).all();
  return new Response(JSON.stringify({ coupons: (result.results || []).map(rowToJson) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // Direct writes are admin-only — managers propose via
  // POST /api/coupon-core/request, same as product catalog changes.
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const code = normalizeCode(body.code);
  if (!code) return jsonError('code is required');
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return jsonError('code must be 3-32 characters: letters, numbers, hyphens, underscores only');
  }

  const fieldError = validateCouponFields(body, { partial: false });
  if (fieldError) return jsonError(fieldError);

  if (body.themeId != null) {
    const theme = await env.DB.prepare('SELECT id FROM site_themes WHERE id = ?').bind(body.themeId).first();
    if (!theme) return jsonError('themeId does not reference an existing theme');
  }

  const existing = await env.DB.prepare('SELECT id FROM site_coupons WHERE code = ?').bind(code).first();
  if (existing) return jsonError(`A coupon with code "${code}" already exists`, 409);

  const result = await env.DB.prepare(
    `INSERT INTO site_coupons
       (code, description, type, value, max_discount_amount, min_subtotal,
        usage_limit, per_user_limit, is_active, theme_id, starts_at, ends_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    code,
    body.description || null,
    body.type,
    body.value,
    Number.isInteger(body.maxDiscountAmount) ? body.maxDiscountAmount : null,
    Number.isInteger(body.minSubtotal) ? body.minSubtotal : 0,
    Number.isInteger(body.usageLimit) ? body.usageLimit : null,
    Number.isInteger(body.perUserLimit) ? body.perUserLimit : 1,
    body.isActive === false ? 0 : 1,
    body.themeId ?? null,
    body.startsAt || null,
    body.endsAt || null,
    user.id, user.id
  ).run();

  await logAudit(env, {
    userId: user.id, action: 'create', resource: 'site_coupon', resourceId: code,
    diff: { type: body.type, value: body.value },
  });

  const row = await env.DB.prepare('SELECT * FROM site_coupons WHERE id = ?').bind(result.meta.last_row_id).first();
  return new Response(JSON.stringify({ ok: true, coupon: rowToJson(row) }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { id, updates } = body;
  if (!Number.isInteger(id)) return jsonError('id is required');
  if (!updates || typeof updates !== 'object') return jsonError('updates object is required');

  const existing = await env.DB.prepare('SELECT * FROM site_coupons WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Coupon not found', 404);

  // Resolve the effective type (existing or incoming) so value-range
  // validation applies correctly even if only `value` is being patched.
  const effective = { ...updates };
  if (!('type' in effective)) effective.type = existing.type;
  const fieldError = validateCouponFields(effective, { partial: true });
  if (fieldError) return jsonError(fieldError);

  if ('themeId' in updates && updates.themeId != null) {
    const theme = await env.DB.prepare('SELECT id FROM site_themes WHERE id = ?').bind(updates.themeId).first();
    if (!theme) return jsonError('themeId does not reference an existing theme');
  }

  // Code changes go through the same normalize+uniqueness path as create.
  if ('code' in updates) {
    const newCode = normalizeCode(updates.code);
    if (!newCode || !/^[A-Z0-9_-]{3,32}$/.test(newCode)) {
      return jsonError('code must be 3-32 characters: letters, numbers, hyphens, underscores only');
    }
    updates.code = newCode;
  }

  const sets = [];
  const binds = [];
  const fieldMap = { ...EDITABLE_FIELDS, code: 'code' };
  for (const [key, column] of Object.entries(fieldMap)) {
    if (!(key in updates)) continue;
    const val = updates[key];
    sets.push(`${column} = ?`);
    binds.push(key === 'isActive' ? (val ? 1 : 0) : (val ?? null));
  }
  if (!sets.length) return jsonError('No editable fields provided');

  sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
  binds.push(user.id, id);

  try {
    await env.DB.prepare(`UPDATE site_coupons SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return jsonError('That code is already in use by another coupon', 409);
    throw err;
  }

  await logAudit(env, { userId: user.id, action: 'update', resource: 'site_coupon', resourceId: existing.code, diff: updates });

  const row = await env.DB.prepare('SELECT * FROM site_coupons WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ ok: true, coupon: rowToJson(row) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin']);
  if (!ok) return forbidden();

  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return jsonError('id query param is required');

  const row = await env.DB.prepare('SELECT id, code, used_count FROM site_coupons WHERE id = ?').bind(id).first();
  if (!row) return jsonError('Coupon not found', 404);

  // Once a coupon has real redemptions tied to real orders, deleting it
  // would orphan/blank out order history (coupon_redemptions cascades on
  // delete). Force a deactivate instead — same "can't delete what's in use"
  // guard as admin/products.js's delete check.
  if (row.used_count > 0) {
    return jsonError(
      `Can't delete — this coupon has been redeemed ${row.used_count} time(s). Set isActive to false via PATCH instead.`,
      409
    );
  }

  await env.DB.prepare('DELETE FROM site_coupons WHERE id = ?').bind(id).run();
  await logAudit(env, { userId: user.id, action: 'delete', resource: 'site_coupon', resourceId: row.code });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}