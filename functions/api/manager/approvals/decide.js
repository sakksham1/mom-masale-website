import { requireApprover, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { syncProductsToGitHub } from '../../_utils/products-sync.js';

const HANDLERS = {
  raw_material: applyRawMaterialDecision,   // unchanged from before
  packaging: applyPackagingDecision,        // unchanged from before
  product_core: applyProductCoreDecision,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireApprover(request, env);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { type, id, decision } = body;

  if (!HANDLERS[type]) return jsonError(`type must be one of: ${Object.keys(HANDLERS).join(', ')}`);
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');
  if (!Number.isInteger(id)) return jsonError('id is required');

  // Catalog changes go straight to the live website, so — unlike raw
  // material / packaging approvals, which any manager or admin can decide —
  // product_core requests are reserved for admins only. Managers can still
  // see them in the queue, just not approve/reject them.
  if (type === 'product_core' && role !== 'admin') {
    return forbidden('Only an admin can approve product catalog changes');
  }

  try {
    await HANDLERS[type](env, id, decision, user);
    await logAudit(env, { userId: user.id, action: decision, resource: type, resourceId: id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, err.status || 400);
  }
}

// ── Packaging: approval increments product_sizes.stock_qty AND writes the
// existing inventory_movements ledger in the same batch — no new table. ──
async function applyPackagingDecision(env, id, decision, reviewer) {
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

// ── raw_material_transactions decision — unchanged logic from before,
// just kept here for a complete file. ──
async function applyRawMaterialDecision(env, id, decision, reviewer) {
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
// PATCH /api/admin/products accepts (name, category, image, flags, seo,
// prices), then re-syncs data/products.json via the same helper the admin
// PATCH endpoint uses. No inventory/stock fields here at all — stock stays
// exclusively in warehouse/inventory adjust flows. ──
async function applyProductCoreDecision(env, id, decision, reviewer) {
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
  const product = await env.DB.prepare('SELECT id, slug FROM products WHERE id = ?').bind(change.product_id).first();
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
        // New size introduced via a catalog edit — same DEFAULT_STOCK
        // convention as admin/products.js, logged the same way.
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

  await syncProductsToGitHub(env, `chore(approval): update ${product.slug}`);

  await env.DB.prepare(
    `UPDATE product_core_change_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(reviewer.id, id).run();
}
