// functions/api/admin/products/import.js
// POST /api/admin/products/import   { defaultStock?: number }
//
// ONE-TIME BOOTSTRAP. Reads the current data/products.json straight from
// GitHub (reusing the same _utils/github.js the old admin/products.js used)
// and inserts each product into D1, with every size's stock_qty defaulted
// to `defaultStock` (100, per your instruction — you'll correct real
// quantities per-product afterwards via inventory/adjust.js).
//
// Idempotent by slug: products that already exist in D1 are skipped, not
// overwritten, so this is safe to re-run if it partially fails partway
// through — it'll just pick up wherever it left off.

import { requireAdmin, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { readRepoFile } from '../../_utils/github.js';

const PRODUCTS_PATH = 'data/products.json';

function defaultSeo(name, category, existingSeo) {
  if (existingSeo) return existingSeo;
  const lower = name.toLowerCase();
  const catLower = (category || '').toLowerCase();
  return {
    title: `Buy ${name} Online | Premium Quality | Mom Masale`,
    metaDescription: `Buy premium quality ${lower} from Mom Masale.`,
    shortDescription: `Premium quality ${lower}.`,
    longDescription: `Mom Masale ${name}.`,
    keywords: [lower, catLower, 'indian spices', 'mom masale'].filter(Boolean),
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const defaultStock = Number.isInteger(body.defaultStock) && body.defaultStock >= 0 ? body.defaultStock : 100;

  let products;
  try {
    const { content } = await readRepoFile(env, PRODUCTS_PATH);
    products = JSON.parse(content);
  } catch (err) {
    return jsonError(`Could not read ${PRODUCTS_PATH} from GitHub: ${err.message}`, 502);
  }

  const imported = [];
  const skipped = [];
  const failed = [];

  for (const p of products) {
    try {
      if (!p.slug) { failed.push({ name: p.name, error: 'missing slug' }); continue; }

      const existing = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(p.slug).first();
      if (existing) { skipped.push(p.slug); continue; }

      const seo = defaultSeo(p.name, p.category, p.seo);

      const insert = await env.DB.prepare(
        `INSERT INTO products
           (slug, name, category, image, image_alt, amazon_url, flipkart_url, meesho_url,
            coming_soon, featured, bestseller, new_arrival,
            seo_title, seo_meta_description, seo_short_description, seo_long_description, seo_keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        p.slug, p.name, p.category, p.image, p.imageAlt || null,
        p.amazon || null, p.flipkart || null, p.meesho || null,
        p.comingSoon ? 1 : 0, p.featured ? 1 : 0, p.bestseller ? 1 : 0, p.newArrival ? 1 : 0,
        seo.title || '', seo.metaDescription || '', seo.shortDescription || '', seo.longDescription || '',
        JSON.stringify(seo.keywords || [])
      ).run();

      const productId = insert.meta.last_row_id;

      const sizes = p.sizes || Object.keys(p.prices || {});
      let sortOrder = 0;
      for (const size of sizes) {
        const price = p.prices ? p.prices[size] : null;
        if (!Number.isFinite(price) || price <= 0) {
          // comingSoon products may legitimately have no price yet — skip the
          // size row rather than fail the whole product import.
          continue;
        }
        await env.DB.prepare(
          `INSERT INTO product_sizes (product_id, size, price, stock_qty, sort_order) VALUES (?, ?, ?, ?, ?)`
        ).bind(productId, size, price, defaultStock, sortOrder++).run();
        await env.DB.prepare(
          `INSERT INTO inventory_movements (product_id, size, change_qty, reason, user_id, note)
           VALUES (?, ?, ?, 'initial', ?, 'bulk import from data/products.json')`
        ).bind(productId, size, defaultStock, user.id).run();
      }

      for (const alias of p.aliases || []) {
        await env.DB.prepare('INSERT INTO product_aliases (product_id, alias) VALUES (?, ?)').bind(productId, alias).run();
      }
      let faqOrder = 0;
      for (const f of p.faq || []) {
        await env.DB.prepare(
          'INSERT INTO product_faq (product_id, question, answer, sort_order) VALUES (?, ?, ?, ?)'
        ).bind(productId, f.question, f.answer, faqOrder++).run();
      }

      imported.push(p.slug);
    } catch (err) {
      failed.push({ slug: p.slug, name: p.name, error: err.message });
    }
  }

  // relatedProducts is resolved in a second pass, after every product has an
  // id — otherwise a product referencing one later in the array would fail.
  for (const p of products) {
    if (!p.relatedProducts?.length) continue;
    const self = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(p.slug).first();
    if (!self) continue;
    for (const relSlug of p.relatedProducts) {
      const rel = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(relSlug).first();
      if (!rel) continue;
      await env.DB.prepare(
        'INSERT OR IGNORE INTO product_related (product_id, related_product_id) VALUES (?, ?)'
      ).bind(self.id, rel.id).run();
    }
  }

  await logAudit(env, {
    userId: user.id, action: 'import', resource: 'product', resourceId: null,
    diff: { imported: imported.length, skipped: skipped.length, failed: failed.length, defaultStock },
  });

  return new Response(JSON.stringify({
    ok: true,
    imported, skipped, failed,
    note: 'GitHub data/products.json was NOT modified. D1 is now ahead of it — the next catalog edit via /api/admin/products will re-sync it, or trigger that manually if you want it synced immediately.',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
