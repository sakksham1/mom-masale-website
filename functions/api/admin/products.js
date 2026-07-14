// functions/api/admin/products.js
// GET    /api/admin/products               — full current products.json
// POST   /api/admin/products                { name, category, prices:{size:price}, image?, comingSoon?, aliases? }
// PATCH  /api/admin/products                { slug, updates: { ...whitelisted fields } }
// DELETE /api/admin/products?slug=...
//
// All writes commit straight to data/products.json in the GitHub repo via the
// Contents API (see _utils/github.js). That commit lands on `main`, which
// generate-site.yml is already watching — so the existing bot rebuilds the
// product pages + sitemap the same way it would if Sakksham had hand-edited
// the JSON and pushed. No parallel "admin data store" to keep in sync.

import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';
import { readRepoFile, writeRepoFile } from '../_utils/github.js';

const PRODUCTS_PATH = 'data/products.json';
const EDITABLE_FIELDS = ['name', 'category', 'prices', 'sizes', 'image', 'imageAlt', 'comingSoon', 'featured', 'bestseller', 'newArrival', 'aliases'];

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  try {
    const { content } = await readRepoFile(env, PRODUCTS_PATH);
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const { name, category, prices, image, comingSoon, aliases } = body;
  if (!name || !category || !prices || Object.keys(prices).length === 0) {
    return jsonError('name, category, and at least one size/price are required');
  }
  for (const [size, price] of Object.entries(prices)) {
    if (!Number.isFinite(price) || price <= 0) {
      return jsonError(`Invalid price for size "${size}" — prices must be positive numbers`);
    }
  }

  try {
    const { content, sha } = await readRepoFile(env, PRODUCTS_PATH);
    const products = JSON.parse(content);

    const slug = slugify(name);
    if (!slug) return jsonError('Could not derive a valid slug from that name');
    if (products.some(p => p.slug === slug)) {
      return jsonError(`A product with slug "${slug}" already exists — choose a different name`, 409);
    }

    const sizes = Object.keys(prices);
    const newProduct = {
      name,
      category,
      sizes,
      prices,
      image: image || `images/products/${slug}.webp`,
      amazon: '#',
      flipkart: '#',
      meesho: '#',
      aliases: Array.isArray(aliases) ? aliases : [],
      slug,
      imageAlt: `Mom Masale ${name} retail pack`,
      featured: false,
      bestseller: false,
      newArrival: true,
      comingSoon: !!comingSoon,
      seo: defaultSeo(name, category),
      faq: [],
      relatedProducts: [],
    };

    products.push(newProduct);
    const newContent = JSON.stringify(products, null, 2) + '\n';
    await writeRepoFile(env, PRODUCTS_PATH, newContent, sha, `chore(admin): add product "${name}"`);

    return new Response(JSON.stringify({ ok: true, product: newProduct }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
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

  try {
    const { content, sha } = await readRepoFile(env, PRODUCTS_PATH);
    const products = JSON.parse(content);
    const idx = products.findIndex(p => p.slug === slug);
    if (idx === -1) return jsonError('Product not found', 404);

    if (updates.prices) {
      for (const [size, price] of Object.entries(updates.prices)) {
        if (!Number.isFinite(price) || price <= 0) {
          return jsonError(`Invalid price for size "${size}" — prices must be positive numbers`);
        }
      }
    }

    for (const key of EDITABLE_FIELDS) {
      if (key in updates) products[idx][key] = updates[key];
    }
    // Keep sizes[] in sync if only prices was sent
    if (updates.prices && !updates.sizes) {
      products[idx].sizes = Object.keys(updates.prices);
    }

    const newContent = JSON.stringify(products, null, 2) + '\n';
    await writeRepoFile(env, PRODUCTS_PATH, newContent, sha, `chore(admin): update product "${slug}"`);

    return new Response(JSON.stringify({ ok: true, product: products[idx] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return jsonError('slug query param is required');

  try {
    const { content, sha } = await readRepoFile(env, PRODUCTS_PATH);
    const products = JSON.parse(content);
    const filtered = products.filter(p => p.slug !== slug);
    if (filtered.length === products.length) return jsonError('Product not found', 404);

    const newContent = JSON.stringify(filtered, null, 2) + '\n';
    await writeRepoFile(env, PRODUCTS_PATH, newContent, sha, `chore(admin): delete product "${slug}"`);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}
