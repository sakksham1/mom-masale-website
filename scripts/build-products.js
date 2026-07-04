#!/usr/bin/env node
'use strict';
/**
 * Mom Masale — Product Page & Sitemap Generator
 * ------------------------------------------------
 * Reads data/products.json (single source of truth) and:
 *   1. Generates one static HTML page per product in /products/{slug}.html
 *   2. Rebuilds sitemap.xml to include every product URL
 *   3. Deletes stale pages for products that no longer exist
 *
 * IDEMPOTENCY GUARANTEE:
 * Running this twice in a row with an unchanged products.json produces
 * byte-identical output (zero git diff). No timestamps, no random
 * ordering, no "last generated" comments. Output is always sorted by slug.
 *
 * OWNERSHIP GUARANTEE:
 * This script only ever touches files it created itself. It tracks what
 * it owns via products/.generated-manifest.json and only deletes files
 * listed there — it will never touch index.html, about.html, etc.
 *
 * Usage: node scripts/build-products.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'products.json');
const OUTPUT_DIR = path.join(ROOT, 'products');
const MANIFEST_PATH = path.join(OUTPUT_DIR, '.generated-manifest.json');
const TEMPLATE_PATH = path.join(__dirname, 'product-template.html');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE_URL = 'https://mommasale.com';

const STATIC_PAGES = [
  { loc: '/', priority: '1.0' },
  { loc: '/products.html', priority: '0.9' },
  { loc: '/about.html', priority: '0.7' },
  { loc: '/bulk-orders.html', priority: '0.8' },
  { loc: '/contact.html', priority: '0.6' },
];

// ── helpers ──────────────────────────────────────────────

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateProducts(products) {
  const seen = new Set();
  products.forEach((p, i) => {
    if (!p.name) throw new Error(`Product at index ${i} is missing "name"`);
    if (!p.slug) throw new Error(`Product "${p.name}" is missing "slug" — add one before building`);
    if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error(`Product "${p.name}" has an invalid slug "${p.slug}" (lowercase letters, numbers, hyphens only)`);
    if (seen.has(p.slug)) throw new Error(`Duplicate slug detected: "${p.slug}" — slugs must be unique`);
    seen.add(p.slug);
  });
}

function buildProductSchema(p) {
  const priceValues = Object.values(p.prices || {});
  const lowPrice = priceValues.length ? Math.min(...priceValues) : undefined;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: `${SITE_URL}/${p.image}`,
    description: (p.seo && (p.seo.shortDescription || p.seo.metaDescription)) || p.name,
    brand: { '@type': 'Brand', name: 'Mom Masale' },
  };
  if (lowPrice !== undefined) {
    schema.offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: lowPrice,
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/products/${p.slug}.html`,
    };
  }
  return schema;
}

// Builds size chips identical in structure to renderCards() in main.js
// so the existing cart JS (delegated on document) works with zero changes.
function buildSizeChipsHtml(p) {
  const DISCOUNT_PERCENT = 25;
  const discounted = (n) => Math.round(n * (1 - DISCOUNT_PERCENT / 100));
  const sizes = p.sizes || [];
  return sizes.map((s, i) => {
    const original = p.prices ? p.prices[s] : undefined;
    const price = original ? discounted(original) : '';
    return `<button type="button" class="size-chip${i === 0 ? ' active' : ''}" data-size="${escapeHtml(s)}" data-price="${price}" data-original="${original || ''}">${escapeHtml(s)}</button>`;
  }).join('');
}

function buildInitialPriceDisplay(p) {
  const sizes = p.sizes || [];
  if (!sizes.length || !p.prices) return '';
  const first = sizes[0];
  const original = p.prices[first];
  if (!original) return '';
  const discounted = Math.round(original * 0.75);
  return `<span class="price-original">₹${original}</span><span class="price-discounted">₹${discounted}</span><span class="discount-badge">25% OFF</span>`;
}

function buildFaqHtml(p) {
  if (!p.faq || !p.faq.length) return '';
  const items = p.faq.map(f => `
            <div class="faq-item">
                <h3 class="faq-question">${escapeHtml(f.question)}</h3>
                <p class="faq-answer">${escapeHtml(f.answer)}</p>
            </div>`).join('');
  return `
<div class="container">
    <h2 class="section-title">Frequently Asked Questions</h2>
    <div class="faq-list">${items}
    </div>
</div>`;
}

function buildRelatedHtml(p, allProducts) {
  const related = allProducts
    .filter(o => o.category === p.category && o.slug !== p.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, 3);
  if (!related.length) return '';
  const cards = related.map(r => `
            <a class="related-card" href="${r.slug}.html">
                <img src="../${r.image}" alt="${escapeHtml(r.imageAlt || r.name)}" loading="lazy" width="160" height="160">
                <span>${escapeHtml(r.name)}</span>
            </a>`).join('');
  return `
<div class="container">
    <h2 class="section-title">You Might Also Like</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function renderProduct(p, allProducts, template) {
  const title = escapeHtml((p.seo && p.seo.title) || `Buy ${p.name} Online | Mom Masale`);
  const metaDesc = escapeHtml((p.seo && (p.seo.metaDescription || p.seo.shortDescription)) || '');
  const longDesc = escapeHtml((p.seo && p.seo.longDescription) || '');
  const keywords = escapeHtml((p.seo && p.seo.keywords || []).join(', '));
  const canonical = `${SITE_URL}/products/${p.slug}.html`;
  const schemaJson = JSON.stringify(buildProductSchema(p), null, 2);

  const replacements = {
    '{{TITLE}}': title,
    '{{META_DESCRIPTION}}': metaDesc,
    '{{KEYWORDS}}': keywords,
    '{{CANONICAL_URL}}': canonical,
    '{{PRODUCT_SCHEMA_JSON}}': schemaJson,
    '{{PRODUCT_NAME}}': escapeHtml(p.name),
    '{{PRODUCT_CATEGORY}}': escapeHtml(p.category),
    '{{PRODUCT_SLUG}}': p.slug,
    '{{PRODUCT_IMAGE}}': escapeHtml(p.image),
    '{{PRODUCT_IMAGE_ALT}}': escapeHtml(p.imageAlt || p.name),
    '{{PRODUCT_LONG_DESCRIPTION}}': longDesc,
    '{{PRODUCT_SIZE_CHIPS}}': buildSizeChipsHtml(p),
    '{{PRODUCT_INITIAL_PRICE_DISPLAY}}': buildInitialPriceDisplay(p),
    '{{PRODUCT_FIRST_SIZE}}': (p.sizes && p.sizes[0]) || '',
    '{{PRODUCT_FIRST_PRICE}}': (p.prices && p.sizes && p.prices[p.sizes[0]]) ? Math.round(p.prices[p.sizes[0]] * 0.75) : '',
    '{{PRODUCT_FIRST_ORIGINAL}}': (p.prices && p.sizes && p.prices[p.sizes[0]]) || '',
    '{{PRODUCT_FAQ_BLOCK}}': buildFaqHtml(p),
    '{{PRODUCT_RELATED_BLOCK}}': buildRelatedHtml(p, allProducts),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

function buildSitemap(products) {
  const urls = STATIC_PAGES.map(pg => `  <url><loc>${SITE_URL}${pg.loc}</loc><priority>${pg.priority}</priority></url>`);
  products
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach(p => {
      urls.push(`  <url><loc>${SITE_URL}/products/${p.slug}.html</loc><priority>0.75</priority></url>`);
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ── main ─────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Cannot find ${DATA_PATH}. This script expects data/products.json to exist.`);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Cannot find ${TEMPLATE_PATH}. Did you move product-template.html?`);
  }

  const products = readJSON(DATA_PATH);
  validateProducts(products);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load manifest of files this script owns from the previous run
  const previousManifest = fs.existsSync(MANIFEST_PATH)
    ? readJSON(MANIFEST_PATH)
    : { files: [] };

  const currentSlugs = new Set(products.map(p => p.slug));

  // Remove pages for products that no longer exist in products.json.
  // Only ever deletes files this script itself created (tracked in manifest).
  let removedCount = 0;
  previousManifest.files.forEach(fname => {
    const slug = fname.replace(/\.html$/, '');
    if (!currentSlugs.has(slug)) {
      const stalePath = path.join(OUTPUT_DIR, fname);
      if (fs.existsSync(stalePath)) {
        fs.unlinkSync(stalePath);
        removedCount++;
        console.log(`  removed stale page: products/${fname}`);
      }
    }
  });

  // Generate/overwrite current pages — sorted for deterministic output
  const sortedProducts = products.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  sortedProducts.forEach(p => {
    const html = renderProduct(p, products, template);
    fs.writeFileSync(path.join(OUTPUT_DIR, `${p.slug}.html`), html, 'utf8');
  });

  // Write manifest — sorted, deterministic, no timestamps
  const manifest = { files: sortedProducts.map(p => `${p.slug}.html`) };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Rebuild sitemap.xml completely from current data — deterministic order
  fs.writeFileSync(SITEMAP_PATH, buildSitemap(products), 'utf8');

  console.log(`\nDone.`);
  console.log(`  generated: ${sortedProducts.length} product pages`);
  console.log(`  removed:   ${removedCount} stale pages`);
  console.log(`  sitemap.xml rebuilt (${STATIC_PAGES.length + products.length} URLs)`);
}

try {
  main();
} catch (err) {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
}
