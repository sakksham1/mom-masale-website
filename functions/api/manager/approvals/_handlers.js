// functions/api/manager/approvals/_handlers.js
// Per-type approval decision logic, shared by the single-item decide.js
// endpoint and the batch decide-batch.js endpoint. Keeping this in one
// place means a batch approval and a single approval can never diverge.

import { enqueueSync, describeCatalogUpdates } from '../../_utils/sync-queue.js';
import { normalizeCode } from '../../_utils/coupons.js'

// ── Packaging: approval increments product_sizes.stock_qty AND writes the
// existing inventory_movements ledger in the same batch — no new table. ──
export async function applyPackagingDecision(env, id, decision, reviewer) {
  const report = await env.DB.prepare(
    `SELECT id, user_id, product_id, size, qty, status FROM packaging_reports WHERE id = ?`
  ).bind(id).first();
  if (!report) throw Object.assign(new Error('Report not found'), { status: 404 });
  if (report.status !== 'pending') throw new Error(`Already ${report.status}`);

  if (decision === 'approved') {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE product_sizes SET stock_qty = stock_qty + ? WHERE product_id = ? AND size = ?`
      ).bind(report.qty, report.product_id, report.size),
      env.DB.prepare(
        `INSERT INTO inventory_movements
           (product_id, size, change_qty, reason, reference_type, reference_id, user_id, note)
         VALUES (?, ?, ?, 'packaging', 'packaging_report', ?, ?, ?)`
      ).bind(report.product_id, report.size, report.qty, report.id, reviewer.id,
             `Approved packaging report #${report.id}`),
      env.DB.prepare(
        `UPDATE packaging_reports SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
      ).bind(reviewer.id, id),
    ]);
  } else {
    await env.DB.prepare(
      `UPDATE packaging_reports SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).bind(reviewer.id, id).run();
  }
}

// ── raw_material_transactions decision ──
export async function applyRawMaterialDecision(env, id, decision, reviewer) {
  const tx = await env.DB.prepare(
    `SELECT id, raw_material_id, delta, status FROM raw_material_transactions WHERE id = ?`
  ).bind(id).first();
  if (!tx) throw Object.assign(new Error('Transaction not found'), { status: 404 });
  if (tx.status !== 'pending') throw new Error(`Already ${tx.status}`);

  if (decision === 'approved') {
    const material = await env.DB.prepare('SELECT qty FROM raw_materials WHERE id = ?').bind(tx.raw_material_id).first();
    if (material.qty + tx.delta < 0) throw new Error('Approving this would take stock negative — reject or ask for a correction');

    await env.DB.batch([
      env.DB.prepare(`UPDATE raw_materials SET qty = qty + ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(tx.delta, tx.raw_material_id),
      env.DB.prepare(`UPDATE raw_material_transactions SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
        .bind(reviewer.id, id),
    ]);
  } else {
    await env.DB.prepare(`UPDATE raw_material_transactions SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`)
      .bind(reviewer.id, id).run();
  }
}

// ── Product core (catalog) — approval applies the same whitelist of fields
// PATCH /api/admin/products accepts, then ENQUEUES a publish-queue row
// instead of immediately committing to GitHub. The actual GitHub commit +
// site rebuild happens only when an admin explicitly publishes via
// POST /api/admin/sync-queue/run. ──
export async function applyProductCoreDecision(env, id, decision, reviewer) {
  const change = await env.DB.prepare(
    `SELECT id, product_id, field, payload, status FROM product_core_change_requests WHERE id = ?`
  ).bind(id).first();
  if (!change) throw Object.assign(new Error('Change request not found'), { status: 404 });
  if (change.status !== 'pending') throw new Error(`Already ${change.status}`);

  if (decision === 'rejected') {
    await env.DB.prepare(
      `UPDATE product_core_change_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).bind(reviewer.id, id).run();
    return;
  }

  const updates = JSON.parse(change.payload);
  const product = await env.DB.prepare('SELECT id, slug, name FROM products WHERE id = ?').bind(change.product_id).first();
  if (!product) throw new Error('Product no longer exists');

  const columnMap = {
    name: 'name', category: 'category', image: 'image', imageAlt: 'image_alt',
    amazonUrl: 'amazon_url', flipkartUrl: 'flipkart_url', meeshoUrl: 'meesho_url',
    comingSoon: 'coming_soon', featured: 'featured', bestseller: 'bestseller', newArrival: 'new_arrival',
  };
  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (key in updates) {
      const val = updates[key];
      sets.push(`${column} = ?`);
      binds.push(typeof val === 'boolean' ? (val ? 1 : 0) : val);
    }
  }
  if (updates.seo && typeof updates.seo === 'object') {
    const s = updates.seo;
    if ('title' in s) { sets.push('seo_title = ?'); binds.push(s.title); }
    if ('metaDescription' in s) { sets.push('seo_meta_description = ?'); binds.push(s.metaDescription); }
    if ('shortDescription' in s) { sets.push('seo_short_description = ?'); binds.push(s.shortDescription); }
    if ('longDescription' in s) { sets.push('seo_long_description = ?'); binds.push(s.longDescription); }
    if ('keywords' in s) { sets.push('seo_keywords = ?'); binds.push(JSON.stringify(s.keywords || [])); }
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    binds.push(product.id);
    await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  }

  if (updates.prices && typeof updates.prices === 'object') {
    for (const [size, price] of Object.entries(updates.prices)) {
      const existingSize = await env.DB.prepare(
        'SELECT id FROM product_sizes WHERE product_id = ? AND size = ?'
      ).bind(product.id, size).first();
      if (existingSize) {
        await env.DB.prepare('UPDATE product_sizes SET price = ? WHERE id = ?').bind(price, existingSize.id).run();
      } else {
        const maxSort = await env.DB.prepare(
          'SELECT COALESCE(MAX(sort_order), -1) as m FROM product_sizes WHERE product_id = ?'
        ).bind(product.id).first();
        await env.DB.prepare(
          `INSERT INTO product_sizes (product_id, size, price, stock_qty, sort_order) VALUES (?, ?, ?, 100, ?)`
        ).bind(product.id, size, price, (maxSort?.m ?? -1) + 1).run();
        await env.DB.prepare(
          `INSERT INTO inventory_movements (product_id, size, change_qty, reason, user_id, note)
           VALUES (?, ?, 100, 'initial', ?, 'size added via approved catalog change')`
        ).bind(product.id, size, reviewer.id).run();
      }
    }
  }

  await env.DB.prepare(
    `UPDATE product_core_change_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(reviewer.id, id).run();

  await enqueueSync(env, {
    sourceType: 'product_core',
    sourceId: change.id,
    productSlug: product.slug,
    summary: describeCatalogUpdates(updates.name || product.name, updates),
    createdBy: reviewer.id,
  });
}

// ── Coupons — approval writes directly to site_coupons. No publish queue
// involved (coupons aren't GitHub-JSON), so this takes effect immediately,
// same as raw_material/packaging decisions above. ──
const COUPON_TYPES = ['percent', 'flat'];

function validateCouponPayload(payload, existing) {
  const type = 'type' in payload ? payload.type : existing?.type;
  if (!COUPON_TYPES.includes(type)) return 'type must be "percent" or "flat"';
  const value = 'value' in payload ? payload.value : existing?.value;
  if (!Number.isInteger(value) || value <= 0) return 'value must be a positive integer';
  if (type === 'percent' && value > 90) return 'percent value cannot exceed 90';
  return null;
}

export async function applyCouponDecision(env, id, decision, reviewer) {
  const change = await env.DB.prepare(
    `SELECT id, coupon_id, action, payload, status FROM coupon_change_requests WHERE id = ?`
  ).bind(id).first();
  if (!change) throw Object.assign(new Error('Change request not found'), { status: 404 });
  if (change.status !== 'pending') throw new Error(`Already ${change.status}`);

  if (decision === 'rejected') {
    await env.DB.prepare(
      `UPDATE coupon_change_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).bind(reviewer.id, id).run();
    return;
  }

  const payload = JSON.parse(change.payload);

  if (change.action === 'create') {
    const code = normalizeCode(payload.code);
    if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error('Invalid coupon code in request');
    const fieldError = validateCouponPayload(payload, null);
    if (fieldError) throw new Error(fieldError);

    const existing = await env.DB.prepare('SELECT id FROM site_coupons WHERE code = ?').bind(code).first();
    if (existing) throw new Error(`A coupon with code "${code}" already exists`);

    if (payload.themeId != null) {
      const theme = await env.DB.prepare('SELECT id FROM site_themes WHERE id = ?').bind(payload.themeId).first();
      if (!theme) throw new Error('themeId does not reference an existing theme');
    }

    await env.DB.prepare(
      `INSERT INTO site_coupons
         (code, description, type, value, max_discount_amount, min_subtotal,
          usage_limit, per_user_limit, is_active, theme_id, starts_at, ends_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      code, payload.description || null, payload.type, payload.value,
      Number.isInteger(payload.maxDiscountAmount) ? payload.maxDiscountAmount : null,
      Number.isInteger(payload.minSubtotal) ? payload.minSubtotal : 0,
      Number.isInteger(payload.usageLimit) ? payload.usageLimit : null,
      Number.isInteger(payload.perUserLimit) ? payload.perUserLimit : 1,
      payload.isActive === false ? 0 : 1,
      payload.themeId ?? null, payload.startsAt || null, payload.endsAt || null,
      change.requested_by, reviewer.id
    ).run();
  } else {
    const existing = await env.DB.prepare('SELECT * FROM site_coupons WHERE id = ?').bind(change.coupon_id).first();
    if (!existing) throw new Error('Coupon no longer exists');

    const fieldError = validateCouponPayload(payload, existing);
    if (fieldError) throw new Error(fieldError);

    const columnMap = {
      description: 'description', type: 'type', value: 'value',
      maxDiscountAmount: 'max_discount_amount', minSubtotal: 'min_subtotal',
      usageLimit: 'usage_limit', perUserLimit: 'per_user_limit',
      isActive: 'is_active', themeId: 'theme_id', startsAt: 'starts_at', endsAt: 'ends_at',
    };
    const sets = [];
    const binds = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (!(key in payload)) continue;
      sets.push(`${column} = ?`);
      binds.push(key === 'isActive' ? (payload[key] ? 1 : 0) : (payload[key] ?? null));
    }
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
      binds.push(reviewer.id, existing.id);
      await env.DB.prepare(`UPDATE site_coupons SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    }
  }

  await env.DB.prepare(
    `UPDATE coupon_change_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(reviewer.id, id).run();
}