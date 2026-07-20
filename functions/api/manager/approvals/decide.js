import { requireApprover, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { readRepoFile, writeRepoFile } from '../../_utils/github.js';

const HANDLERS = {
  raw_material: applyRawMaterialDecision,   // unchanged from before
  packaging: applyPackagingDecision,
  product_core: applyProductCoreDecision,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireApprover(request, env);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { type, id, decision } = body;

  if (!HANDLERS[type]) return jsonError(`type must be one of: ${Object.keys(HANDLERS).join(', ')}`);
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');
  if (!Number.isInteger(id)) return jsonError('id is required');

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

// ── Product core (name/price) — the one table whose approval also fans
// out to data/products.json via the existing GitHub commit machinery, so
// the same push already triggers generate-site.yml. No separate rebuild
// step needed. ──
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

  const payload = JSON.parse(change.payload);
  const product = await env.DB.prepare('SELECT id, slug, name FROM products WHERE id = ?').bind(change.product_id).first();
  if (!product) throw new Error('Product no longer exists');

  // 1) Apply to D1
  if (change.field === 'name') {
    if (!payload.name) throw new Error('Missing name in payload');
    await env.DB.prepare(`UPDATE products SET name = ? WHERE id = ?`).bind(payload.name, product.id).run();
  } else if (change.field === 'price') {
    if (!payload.size || !Number.isFinite(payload.price)) throw new Error('Missing size/price in payload');
    await env.DB.prepare(
      `UPDATE product_sizes SET price = ? WHERE product_id = ? AND size = ?`
    ).bind(payload.price, product.id, payload.size).run();
  } else {
    throw new Error(`Unknown field "${change.field}"`);
  }

  // 2) Mirror the same field onto data/products.json and commit — reuses
  // the exact pattern products.js already uses for direct admin edits.
  const { content, sha } = await readRepoFile(env, 'data/products.json');
  const products = JSON.parse(content);
  const idx = products.findIndex(p => p.slug === product.slug);
  if (idx === -1) throw new Error(`Product "${product.slug}" not found in products.json — data may be out of sync`);

  if (change.field === 'name') {
    products[idx].name = payload.name;
  } else {
    products[idx].prices = { ...products[idx].prices, [payload.size]: payload.price };
  }

  const newContent = JSON.stringify(products, null, 2) + '\n';
  await writeRepoFile(env, 'data/products.json', newContent, sha, `chore(approval): update ${product.slug} ${change.field}`);

  // 3) Mark decided last, only after both writes succeeded
  await env.DB.prepare(
    `UPDATE product_core_change_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).bind(reviewer.id, id).run();
}