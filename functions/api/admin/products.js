// functions/api/admin/products.js
// GET    /api/admin/products               — full catalog from D1, incl. per-size stock
// POST   /api/admin/products                { name, category, prices:{size:price}, image?, comingSoon?, aliases?, defaultStock? }
// PATCH  /api/admin/products                { slug, updates: { ...whitelisted fields } }
// DELETE /api/admin/products?slug=...
//
// D1 is now the source of truth (migrations/0002_products_and_inventory.sql).
// Every write here re-syncs data/products.json to GitHub so the existing
// generate-site.yml pipeline rebuilds the storefront pages unchanged — see
// _utils/products-sync.js. Stock is NOT part of that sync; see
// admin/inventory/adjust.js for stock changes.

import { requireAdmin, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { readRepoFile } from '../_utils/github.js';
import { syncProductsToGitHub } from '../_utils/products-sync.js';

const DEFAULT_STOCK = 100;

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function defaultSeo(name, category) {
  const lower = name.toLowerCase();
  const catLower = (category || '').toLowerCase();
  return {
    title: `Buy ${name} Online | Premium Quality | Mom Masale`,
    metaDescription: `Buy premium quality ${lower} from Mom Masale. Hygienically packed, rich in aroma and flavour, ideal for authentic Indian cooking.`,
    shortDescription: `Premium quality ${lower} prepared from carefully selected ingredients to deliver authentic taste, rich aroma and consistent flavour for everyday Indian cooking.`,
    longDescription: `Mom Masale ${name} is crafted using carefully selected ingredients and hygienically processed to preserve natural aroma, freshness and authentic flavour. Perfect for home kitchens as well as restaurants, it blends easily into a wide variety of Indian recipes while delivering consistent taste in every serving. Available in multiple pack sizes, it is a reliable choice for everyday cooking and special occasions alike.`,
    keywords: [lower, catLower, 'indian spices', 'mom masale'].filter(Boolean),
  };
}

// Same reference check build-site.js's validateRecipes/validateBlog rely on —
// recipes.json and blog.json are still GitHub-JSON (out of scope this phase),
// so this still reads them directly rather than from D1.
async function findProductReferences(env, slug) {
  const refs = [];

  const { content: recipesContent } = await readRepoFile(env, 'data/recipes.json');
  const recipes = JSON.parse(recipesContent);
  recipes.forEach(r => {
    const inRelated = (r.relatedProducts || []).includes(slug);
    const inIngredients = (r.ingredients || []).some(ing => ing.productSlug === slug);
    if (inRelated || inIngredients) refs.push(`recipe "${r.title}"`);
  });

  const { content: blogContent } = await readRepoFile(env, 'data/blog.json');
  const blogPosts = JSON.parse(blogContent);
  blogPosts.forEach(b => {
    if ((b.relatedProducts || []).includes(slug)) refs.push(`blog post "${b.title}"`);
  });

  return refs;
}

async function loadFullProduct(env, id) {
  const [product, sizes, aliases, faq, related] = await Promise.all([
    env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first(),
    env.DB.prepare('SELECT size, price, stock_qty, sort_order FROM product_sizes WHERE product_id = ? ORDER BY sort_order, id').bind(id).all(),
    env.DB.prepare('SELECT alias FROM product_aliases WHERE product_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT question, answer FROM product_faq WHERE product_id = ? ORDER BY sort_order, id').bind(id).all(),
    env.DB.prepare(
      `SELECT p.slug FROM product_related pr JOIN products p ON p.id = pr.related_product_id WHERE pr.product_id = ?`
    ).bind(id).all(),
  ]);
  if (!product) return null;
  return {
    ...product,
    sizes: sizes.results || [],
    aliases: (aliases.results || []).map(a => a.alias),
    faq: faq.results || [],
    related_products: (related.results || []).map(r => r.slug),
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const [products, sizes, aliases, faqs, related] = await Promise.all([
    env.DB.prepare('SELECT * FROM products ORDER BY name').all(),
    env.DB.prepare('SELECT * FROM product_sizes ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM product_aliases ORDER BY product_id, id').all(),
    env.DB.prepare('SELECT * FROM product_faq ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare(
      `SELECT pr.product_id, p.slug FROM product_related pr JOIN products p ON p.id = pr.related_product_id`
    ).all(),
  ]);

  const group = (rows, key) => rows.reduce((acc, r) => ((acc[r[key]] ||= []).push(r), acc), {});
  const sizesByProduct = group(sizes.results || [], 'product_id');
  const aliasesByProduct = group(aliases.results || [], 'product_id');
  const faqByProduct = group(faqs.results || [], 'product_id');
  const relatedByProduct = group(related.results || [], 'product_id');

  const out = (products.results || []).map(p => ({
    ...p,
    sizes: (sizesByProduct[p.id] || []).map(s => ({ size: s.size, price: s.price, stock_qty: s.stock_qty })),
    aliases: (aliasesByProduct[p.id] || []).map(a => a.alias),
    faq: (faqByProduct[p.id] || []).map(f => ({ question: f.question, answer: f.answer })),
    related_products: (relatedByProduct[p.id] || []).map(r => r.slug),
  }));

  return new Response(JSON.stringify({ products: out }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { name, category, prices, image, comingSoon, aliases, defaultStock } = body;
  if (!name || !category || !prices || Object.keys(prices).length === 0) {
    return jsonError('name, category, and at least one size/price are required');
  }
  for (const [size, price] of Object.entries(prices)) {
    if (!Number.isFinite(price) || price <= 0) {
      return jsonError(`Invalid price for size "${size}" — prices must be positive numbers`);
    }
  }

  const slug = slugify(name);
  if (!slug) return jsonError('Could not derive a valid slug from that name');

  const existing = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
  if (existing) return jsonError(`A product with slug "${slug}" already exists — choose a different name`, 409);

  const seo = defaultSeo(name, category);
  const stock = Number.isInteger(defaultStock) && defaultStock >= 0 ? defaultStock : DEFAULT_STOCK;

  const insert = await env.DB.prepare(
    `INSERT INTO products
       (slug, name, category, image, image_alt, coming_soon,
        seo_title, seo_meta_description, seo_short_description, seo_long_description, seo_keywords)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    slug, name, category, image || `images/products/${slug}.webp`, `Mom Masale ${name} retail pack`,
    comingSoon ? 1 : 0,
    seo.title, seo.metaDescription, seo.shortDescription, seo.longDescription, JSON.stringify(seo.keywords)
  ).run();

  const productId = insert.meta.last_row_id;

  let sortOrder = 0;
  for (const [size, price] of Object.entries(prices)) {
    await env.DB.prepare(
      `INSERT INTO product_sizes (product_id, size, price, stock_qty, sort_order) VALUES (?, ?, ?, ?, ?)`
    ).bind(productId, size, price, stock, sortOrder++).run();
    await env.DB.prepare(
      `INSERT INTO inventory_movements (product_id, size, change_qty, reason, user_id, note)
       VALUES (?, ?, ?, 'initial', ?, 'product created')`
    ).bind(productId, size, stock, user.id).run();
  }

  for (const alias of Array.isArray(aliases) ? aliases : []) {
    await env.DB.prepare(`INSERT INTO product_aliases (product_id, alias) VALUES (?, ?)`).bind(productId, alias).run();
  }

  try {
    await syncProductsToGitHub(env, `chore(admin): add product "${name}"`);
  } catch (err) {
    return jsonError(`Product saved to database, but the site sync failed: ${err.message}`, 502);
  }

  await logAudit(env, { userId: user.id, action: 'create', resource: 'product', resourceId: slug, diff: { name, category, prices, defaultStock: stock } });

  const full = await loadFullProduct(env, productId);
  return new Response(JSON.stringify({ ok: true, product: full }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { slug, updates } = body;
  if (!slug || !updates || typeof updates !== 'object') {
    return jsonError('slug and an updates object are required');
  }

  const product = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first();
  if (!product) return jsonError('Product not found', 404);

  // Simple scalar fields — build a dynamic UPDATE from whatever was sent.
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

  // Prices — updates existing size rows in place (stock_qty untouched, since
  // stock is managed exclusively through inventory/adjust.js, not here).
  if (updates.prices && typeof updates.prices === 'object') {
    for (const [size, price] of Object.entries(updates.prices)) {
      if (!Number.isFinite(price) || price <= 0) {
        return jsonError(`Invalid price for size "${size}" — prices must be positive numbers`);
      }
      const existingSize = await env.DB.prepare(
        'SELECT id FROM product_sizes WHERE product_id = ? AND size = ?'
      ).bind(product.id, size).first();
      if (existingSize) {
        await env.DB.prepare('UPDATE product_sizes SET price = ? WHERE id = ?').bind(price, existingSize.id).run();
      } else {
        // New size — starts at DEFAULT_STOCK, same convention as product creation.
        const maxSort = await env.DB.prepare(
          'SELECT COALESCE(MAX(sort_order), -1) as m FROM product_sizes WHERE product_id = ?'
        ).bind(product.id).first();
        await env.DB.prepare(
          `INSERT INTO product_sizes (product_id, size, price, stock_qty, sort_order) VALUES (?, ?, ?, ?, ?)`
        ).bind(product.id, size, price, DEFAULT_STOCK, (maxSort?.m ?? -1) + 1).run();
        await env.DB.prepare(
          `INSERT INTO inventory_movements (product_id, size, change_qty, reason, user_id, note)
           VALUES (?, ?, ?, 'initial', ?, 'size added via product update')`
        ).bind(product.id, size, DEFAULT_STOCK, user.id).run();
      }
    }
  }

  if (Array.isArray(updates.aliases)) {
    await env.DB.prepare('DELETE FROM product_aliases WHERE product_id = ?').bind(product.id).run();
    for (const alias of updates.aliases) {
      await env.DB.prepare('INSERT INTO product_aliases (product_id, alias) VALUES (?, ?)').bind(product.id, alias).run();
    }
  }

  if (Array.isArray(updates.faq)) {
    await env.DB.prepare('DELETE FROM product_faq WHERE product_id = ?').bind(product.id).run();
    let i = 0;
    for (const f of updates.faq) {
      if (!f.question || !f.answer) continue;
      await env.DB.prepare(
        'INSERT INTO product_faq (product_id, question, answer, sort_order) VALUES (?, ?, ?, ?)'
      ).bind(product.id, f.question, f.answer, i++).run();
    }
  }

  if (Array.isArray(updates.relatedProducts)) {
    const resolved = [];
    for (const relSlug of updates.relatedProducts) {
      const rel = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(relSlug).first();
      if (!rel) return jsonError(`relatedProducts references unknown product slug "${relSlug}"`);
      resolved.push(rel.id);
    }
    await env.DB.prepare('DELETE FROM product_related WHERE product_id = ?').bind(product.id).run();
    for (const relId of resolved) {
      await env.DB.prepare('INSERT INTO product_related (product_id, related_product_id) VALUES (?, ?)').bind(product.id, relId).run();
    }
  }

  try {
    await syncProductsToGitHub(env, `chore(admin): update product "${slug}"`);
  } catch (err) {
    return jsonError(`Product updated in database, but the site sync failed: ${err.message}`, 502);
  }

  await logAudit(env, { userId: user.id, action: 'update', resource: 'product', resourceId: slug, diff: updates });

  const full = await loadFullProduct(env, product.id);
  return new Response(JSON.stringify({ ok: true, product: full }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  const force = url.searchParams.get('force') === '1';
  if (!slug) return jsonError('slug query param is required');

  const product = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
  if (!product) return jsonError('Product not found', 404);

  const refs = await findProductReferences(env, slug);
  if (refs.length > 0 && !force) {
    return jsonError(
      `Can't delete — referenced by ${refs.join(', ')}. Remove those references first, or resend with ?force=1 to delete anyway (will break the next site build until fixed).`,
      409
    );
  }

  // product_sizes / product_aliases / product_faq / product_related-as-source
  // all cascade via ON DELETE CASCADE. Rows where this product is the TARGET
  // of a relation do not cascade (see migrations/0002 note) — clean those here.
  await env.DB.prepare('DELETE FROM product_related WHERE related_product_id = ?').bind(product.id).run();
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(product.id).run();

  try {
    await syncProductsToGitHub(env, `chore(admin): delete product "${slug}"`);
  } catch (err) {
    return jsonError(`Product deleted from database, but the site sync failed: ${err.message}`, 502);
  }

  await logAudit(env, { userId: user.id, action: 'delete', resource: 'product', resourceId: slug });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
