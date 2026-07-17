#!/usr/bin/env node
'use strict';
/**
 * Mom Masale — Unified Site Generator (Products + Recipes)
 * ----------------------------------------------------------
 * Single script, single pass, two collections:
 *   data/products.json -> /products/{slug}.html
 *   data/recipes.json  -> /recipes/{slug}.html
 *
 * Cross-links both collections automatically, using slugs as the join key:
 *   - Product pages get a "Recipes Using This" section
 *   - Recipe pages get shoppable ingredient links + a "Shop the Ingredients" section
 * Also rebuilds sitemap.xml covering both collections + static pages.
 *
 * Merging these into one script (rather than two independent generators)
 * means the cross-referencing is always computed from the same in-memory
 * data on every run — there's no scenario where products.json changes but
 * recipes.json's view of it goes stale, because both are read once per run
 * and rendered together.
 *
 * IDEMPOTENCY GUARANTEE: unchanged data in => byte-identical output.
 * Sorted by slug everywhere, no timestamps, no random ordering.
 *
 * OWNERSHIP GUARANTEE: only ever touches files it generated itself, tracked
 * via products/.generated-manifest.json and recipes/.generated-manifest.json.
 * Never touches index.html, about.html, recipes.html, products.html, etc.
 *
 * Usage: node scripts/build-site.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS_DATA_PATH = path.join(ROOT, 'data', 'products.json');
const RECIPES_DATA_PATH = path.join(ROOT, 'data', 'recipes.json');
const BLOG_DATA_PATH = path.join(ROOT, 'data', 'blog.json');

const PRODUCTS_OUTPUT_DIR = path.join(ROOT, 'products');
const RECIPES_OUTPUT_DIR = path.join(ROOT, 'recipes');
const BLOG_OUTPUT_DIR = path.join(ROOT, 'guide');

const PRODUCTS_MANIFEST_PATH = path.join(PRODUCTS_OUTPUT_DIR, '.generated-manifest.json');
const RECIPES_MANIFEST_PATH = path.join(RECIPES_OUTPUT_DIR, '.generated-manifest.json');
const BLOG_MANIFEST_PATH = path.join(BLOG_OUTPUT_DIR, '.generated-manifest.json');

const PRODUCT_TEMPLATE_PATH = path.join(__dirname, 'product-template.html');
const RECIPE_TEMPLATE_PATH = path.join(__dirname, 'recipe-template.html');
const BLOG_TEMPLATE_PATH = path.join(__dirname, 'blog-template.html');

const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE_URL = 'https://mommasale.com';
const LASTMOD_CACHE_PATH = path.join(ROOT, 'data', '.lastmod-cache.json');

const STATIC_PAGES = [
  { loc: '/', priority: '1.0', file: 'index.html' },
  { loc: '/products', priority: '0.9', file: 'products.html' },
  { loc: '/recipes', priority: '0.85', file: 'recipes.html' },
  { loc: '/spice-guide.html', priority: '0.8', file: 'spice-guide.html' },
  { loc: '/about', priority: '0.7', file: 'about.html' },
  { loc: '/contact', priority: '0.6', file: 'contact.html' },
];

const DISCOUNT_PERCENT = 25;

// ── shared helpers ──────────────────────────────────────

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

function discountedPrice(original) {
  return Math.round(original * (1 - DISCOUNT_PERCENT / 100));
}

// ── lastmod tracking (content-hash based, persisted across builds) ──

function hashItem(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Real last-commit date for a static file, straight from git history.
// Falls back to today if the file has no commit history yet (e.g. a
// brand-new file that hasn't been committed at build time) or if git
// isn't available in the environment running the build.
function gitLastmod(relativeFilePath) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${relativeFilePath}"`, {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return out ? out.slice(0, 10) : todayISO();
  } catch (err) {
    return todayISO();
  }
}

function loadLastmodCache() {
  return fs.existsSync(LASTMOD_CACHE_PATH) ? readJSON(LASTMOD_CACHE_PATH) : {};
}

// Builds the updated cache for one collection (products or recipes).
// A slug's lastmod only advances to today when its content hash actually
// changes from the previous build; unchanged items keep their prior date.
function computeLastmods(items, prevCache, keyPrefix) {
  const updated = {};
  items.forEach(item => {
    const key = keyPrefix + item.slug;
    const hash = hashItem(item);
    const prev = prevCache[key];
    const lastmod = (prev && prev.hash === hash) ? prev.lastmod : todayISO();
    updated[key] = { hash, lastmod };
  });
  return updated;
}

// Parses the simple "PT#H#M" / "PT#M" ISO 8601 durations used in this
// dataset into total minutes.
function isoDurationToMinutes(iso) {
  if (!iso) return 0;
  const hMatch = iso.match(/(\d+)H/);
  const mMatch = iso.match(/(\d+)M/);
  const hours = hMatch ? parseInt(hMatch[1], 10) : 0;
  const minutes = mMatch ? parseInt(mMatch[1], 10) : 0;
  return hours * 60 + minutes;
}

function minutesToIsoDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let iso = 'PT';
  if (hours) iso += `${hours}H`;
  if (minutes || !hours) iso += `${minutes}M`;
  return iso;
}

// ── validation ──────────────────────────────────────────

function validateProducts(products) {
  const seen = new Set();
  products.forEach((p, i) => {
    if (!p.name) throw new Error(`Product at index ${i} is missing "name"`);
    if (!p.slug) throw new Error(`Product "${p.name}" is missing "slug" — add one before building`);
    if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error(`Product "${p.name}" has an invalid slug "${p.slug}" (lowercase letters, numbers, hyphens only)`);
    if (seen.has(p.slug)) throw new Error(`Duplicate product slug detected: "${p.slug}" — slugs must be unique`);
    seen.add(p.slug);
  });
}

function validateRecipes(recipes, productSlugSet) {
  const seen = new Set();
  recipes.forEach((r, i) => {
    if (!r.title) throw new Error(`Recipe at index ${i} is missing "title"`);
    if (!r.slug) throw new Error(`Recipe "${r.title}" is missing "slug" — add one before building`);
    if (!/^[a-z0-9-]+$/.test(r.slug)) throw new Error(`Recipe "${r.title}" has an invalid slug "${r.slug}" (lowercase letters, numbers, hyphens only)`);
    if (seen.has(r.slug)) throw new Error(`Duplicate recipe slug detected: "${r.slug}" — slugs must be unique`);
    seen.add(r.slug);

    (r.ingredients || []).forEach(ing => {
      if (ing.productSlug && !productSlugSet.has(ing.productSlug)) {
        throw new Error(`Recipe "${r.title}" references unknown product slug "${ing.productSlug}" in its ingredients — check for typos or a renamed product slug`);
      }
    });
    (r.relatedProducts || []).forEach(slug => {
      if (!productSlugSet.has(slug)) {
        throw new Error(`Recipe "${r.title}" lists unknown product slug "${slug}" in relatedProducts — check for typos or a renamed product slug`);
      }
    });
  });
}

const BLOG_CATEGORIES = ['Articles', 'FAQs', 'Buying Guides', 'Cooking Tips', 'Ingredient Comparisons'];

function validateBlog(blogPosts, productSlugSet, recipeSlugSet) {
  const seen = new Set();
  blogPosts.forEach((b, i) => {
    if (!b.title) throw new Error(`Blog post at index ${i} is missing "title"`);
    if (!b.slug) throw new Error(`Blog post "${b.title}" is missing "slug" — add one before building`);
    if (!/^[a-z0-9-]+$/.test(b.slug)) throw new Error(`Blog post "${b.title}" has an invalid slug "${b.slug}" (lowercase letters, numbers, hyphens only)`);
    if (seen.has(b.slug)) throw new Error(`Duplicate blog slug detected: "${b.slug}" — slugs must be unique`);
    seen.add(b.slug);
    if (!BLOG_CATEGORIES.includes(b.category)) {
      throw new Error(`Blog post "${b.title}" has an unrecognized category "${b.category}" — must be one of: ${BLOG_CATEGORIES.join(', ')}`);
    }
    (b.relatedProducts || []).forEach(slug => {
      if (!productSlugSet.has(slug)) {
        throw new Error(`Blog post "${b.title}" references unknown product slug "${slug}" in relatedProducts`);
      }
    });
    (b.relatedRecipes || []).forEach(slug => {
      if (!recipeSlugSet.has(slug)) {
        throw new Error(`Blog post "${b.title}" references unknown recipe slug "${slug}" in relatedRecipes`);
      }
    });
  });
}

// ── cross-reference logic (the actual interlinking) ──

// For a given product slug, find every recipe that uses it — either
// listed explicitly in relatedProducts or referenced by an ingredient.
function findRecipesForProduct(productSlug, recipes) {
  return recipes
    .filter(r =>
      (r.relatedProducts || []).includes(productSlug) ||
      (r.ingredients || []).some(ing => ing.productSlug === productSlug)
    )
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function findBlogForProduct(productSlug, blogPosts) {
  return blogPosts
    .filter(b => (b.relatedProducts || []).includes(productSlug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function findBlogForRecipe(recipeSlug, blogPosts) {
  return blogPosts
    .filter(b => (b.relatedRecipes || []).includes(recipeSlug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// ── PRODUCT rendering ────────────────────────────────────

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

function buildProductBreadcrumbSchema(p) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Products', item: `${SITE_URL}/products` },
      { '@type': 'ListItem', position: 3, name: p.name, item: `${SITE_URL}/products/${p.slug}` },
    ],
  };
}

function buildSizeChipsHtml(p) {
  const sizes = p.sizes || [];
  return sizes.map((s, i) => {
    const original = p.prices ? p.prices[s] : undefined;
    const price = original ? discountedPrice(original) : '';
    return `<button type="button" class="size-chip${i === 0 ? ' active' : ''}" data-size="${escapeHtml(s)}" data-price="${price}" data-original="${original || ''}">${escapeHtml(s)}</button>`;
  }).join('');
}

function buildPurchaseBlockHtml(p) {
  if (p.comingSoon) {
    return `
            <div class="launching-soon-panel">🚀 Launching Soon</div>`;
  }
  return `
            <div class="purchase-row" style="display:flex">
                <div class="product-controls">
                    <div class="size-chip-row" data-selected="${(p.sizes && p.sizes[0]) || ''}" data-selected-price="${(p.prices && p.sizes && p.prices[p.sizes[0]]) ? discountedPrice(p.prices[p.sizes[0]]) : ''}" data-selected-original="${(p.prices && p.sizes && p.prices[p.sizes[0]]) || ''}">
                        ${buildSizeChipsHtml(p)}
                    </div>
                    <div class="add-to-cart-block">
                        <div class="price-display">
                            ${buildInitialPriceDisplay(p)}
                        </div>
                        <div class="cart-action">
                            <button type="button" class="btn add-to-cart-btn" data-name="${escapeHtml(p.name)}">Add to Cart</button>
                            <div class="card-qty-stepper" hidden>
                                <button type="button" class="card-qty-btn" data-action="dec">−</button>
                                <span class="card-qty-value">1</span>
                                <button type="button" class="card-qty-btn" data-action="inc">+</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="other-size-note" hidden></div>`;
}

function buildInitialPriceDisplay(p) {
  const sizes = p.sizes || [];
  if (!sizes.length || !p.prices) return '';
  const first = sizes[0];
  const original = p.prices[first];
  if (!original) return '';
  const discounted = discountedPrice(original);
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

function buildRelatedProductsForProductHtml(p, allProducts) {
  const related = allProducts
    .filter(o => o.category === p.category && o.slug !== p.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, 3);
  if (!related.length) return '';
  const cards = related.map(r => `
            <a class="related-card" href="${r.slug}">
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

// "Recipes Using This" section on product pages — the product -> recipe link
function buildRelatedRecipesForProductHtml(p, recipes) {
  const related = findRecipesForProduct(p.slug, recipes);
  if (!related.length) return '';
  const cards = related.map(r => `
            <a class="related-card recipe-related-card" href="../recipes/${r.slug}">
                <img src="../${r.image}" alt="${escapeHtml(r.imageAlt || r.title)}" loading="lazy" width="160" height="160"
                    onerror="this.src='https://placehold.co/160x160/7b1120/fff?text=${encodeURIComponent(r.title)}'">
                <span>${escapeHtml(r.title)}</span>
            </a>`).join('');
  return `
<div class="container">
    <h2 class="section-title">Recipes Using This</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function buildRelatedBlogForProductHtml(p, blogPosts) {
  const related = findBlogForProduct(p.slug, blogPosts);
  if (!related.length) return '';
  const cards = related.map(b => `
            <a class="related-card recipe-related-card" href="../guide/${b.slug}.html">
                <img src="../${b.image}" alt="${escapeHtml(b.imageAlt || b.title)}" loading="lazy" width="160" height="160"
                    onerror="this.src='https://placehold.co/160x160/7b1120/fff?text=${encodeURIComponent(b.title)}'">
                <span>${escapeHtml(b.title)}</span>
            </a>`).join('');
  return `
<div class="container">
    <h2 class="section-title">From the Spice Guide</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function renderProduct(p, allProducts, recipes, blogPosts, template) {
  const title = escapeHtml((p.seo && p.seo.title) || `Buy ${p.name} Online | Mom Masale`);
  const metaDesc = escapeHtml((p.seo && (p.seo.metaDescription || p.seo.shortDescription)) || '');
  const longDesc = escapeHtml((p.seo && p.seo.longDescription) || '');
  const keywords = escapeHtml((p.seo && p.seo.keywords || []).join(', '));
  const canonical = `${SITE_URL}/products/${p.slug}`;
  const schemaJson = JSON.stringify(buildProductSchema(p), null, 2);

  const replacements = {
    '{{TITLE}}': title,
    '{{META_DESCRIPTION}}': metaDesc,
    '{{KEYWORDS}}': keywords,
    '{{CANONICAL_URL}}': canonical,
    '{{PRODUCT_SCHEMA_JSON}}': schemaJson,
    '{{PRODUCT_BREADCRUMB_JSON}}': JSON.stringify(buildProductBreadcrumbSchema(p), null, 2),
    '{{PRODUCT_NAME}}': escapeHtml(p.name),
    '{{PRODUCT_CATEGORY}}': escapeHtml(p.category),
    '{{PRODUCT_SLUG}}': p.slug,
    '{{PRODUCT_IMAGE}}': escapeHtml(p.image),
    '{{PRODUCT_IMAGE_ALT}}': escapeHtml(p.imageAlt || p.name),
    '{{PRODUCT_LONG_DESCRIPTION}}': longDesc,
    '{{PRODUCT_COMING_SOON_CLASS}}': p.comingSoon ? ' card--coming-soon' : '',
    '{{PRODUCT_COMING_SOON_RIBBON}}': p.comingSoon ? '<span class="launching-ribbon">Launching Soon</span>' : '',
    '{{PRODUCT_PURCHASE_BLOCK}}': buildPurchaseBlockHtml(p),
    '{{PRODUCT_FAQ_BLOCK}}': buildFaqHtml(p),
    '{{PRODUCT_RELATED_BLOCK}}': buildRelatedProductsForProductHtml(p, allProducts),
    '{{PRODUCT_RELATED_RECIPES_BLOCK}}': buildRelatedRecipesForProductHtml(p, recipes),
    '{{PRODUCT_RELATED_BLOG_BLOCK}}': buildRelatedBlogForProductHtml(p, blogPosts),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

// ── RECIPE rendering ─────────────────────────────────────

function buildRecipeSchema(r) {
  const totalMinutes = isoDurationToMinutes(r.prepTime) + isoDurationToMinutes(r.cookTime);
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.title,
    image: [`${SITE_URL}/${r.image}`],
    description: r.description || r.title,
    recipeCuisine: r.cuisine || undefined,
    recipeCategory: r.category || undefined,
    prepTime: r.prepTime || undefined,
    cookTime: r.cookTime || undefined,
    totalTime: minutesToIsoDuration(totalMinutes),
    recipeYield: r.servings ? `${r.servings} servings` : undefined,
    recipeIngredient: (r.ingredients || []).map(ing => ing.text),
    recipeInstructions: (r.steps || []).map(step => ({ '@type': 'HowToStep', text: step })),
    author: { '@type': 'Organization', name: 'Mom Masale' },
  };
}

function buildRecipeBreadcrumbSchema(r) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Recipes', item: `${SITE_URL}/recipes` },
      { '@type': 'ListItem', position: 3, name: r.title, item: `${SITE_URL}/recipes/${r.slug}` },
    ],
  };
}

// Recipe -> product link: each ingredient with a productSlug gets a shop link
function buildIngredientsHtml(r, productBySlug) {
  return (r.ingredients || []).map(ing => {
    const product = ing.productSlug ? productBySlug.get(ing.productSlug) : null;
    const shopLink = product
    ? `<a class="ingredient-shop-link" href="../products/${product.slug}">🛒 Shop ${escapeHtml(product.name)}</a>`
      : '';
    return `
            <li class="ingredient-item">
                <span class="ingredient-text">${escapeHtml(ing.text)}</span>
                ${shopLink}
            </li>`;
  }).join('');
}

function buildStepsHtml(r) {
  return (r.steps || []).map(step => `
            <li class="recipe-step">${escapeHtml(step)}</li>`).join('');
}

// "Shop the Ingredients" section on recipe pages
function buildShopIngredientsHtml(r, productBySlug) {
  const slugs = [...new Set(
    (r.ingredients || []).map(ing => ing.productSlug).filter(Boolean)
      .concat(r.relatedProducts || [])
  )].sort();
  if (!slugs.length) return '';
  const cards = slugs.map(slug => {
    const p = productBySlug.get(slug);
    if (!p) return '';
    return `
            <a class="related-card" href="../products/${p.slug}">
                <img src="../${p.image}" alt="${escapeHtml(p.imageAlt || p.name)}" loading="lazy" width="160" height="160">
                <span>${escapeHtml(p.name)}</span>
            </a>`;
  }).join('');
  return `
<div class="container">
    <h2 class="section-title">Shop the Ingredients</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function buildRelatedRecipesForRecipeHtml(r, allRecipes) {
  const related = allRecipes
    .filter(o => o.category === r.category && o.slug !== r.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, 3);
  if (!related.length) return '';
  const cards = related.map(o => `
            <a class="related-card recipe-related-card" href="${o.slug}">
                <img src="../${o.image}" alt="${escapeHtml(o.imageAlt || o.title)}" loading="lazy" width="160" height="160"
                    onerror="this.src='https://placehold.co/160x160/7b1120/fff?text=${encodeURIComponent(o.title)}'">
                <span>${escapeHtml(o.title)}</span>
            </a>`).join('');
  return `
<div class="container">
    <h2 class="section-title">More Recipes</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function buildRelatedBlogForRecipeHtml(r, blogPosts) {
  const related = findBlogForRecipe(r.slug, blogPosts);
  if (!related.length) return '';
  const cards = related.map(b => `
            <a class="related-card recipe-related-card" href="../guide/${b.slug}.html">
                <img src="../${b.image}" alt="${escapeHtml(b.imageAlt || b.title)}" loading="lazy" width="160" height="160"
                    onerror="this.src='https://placehold.co/160x160/7b1120/fff?text=${encodeURIComponent(b.title)}'">
                <span>${escapeHtml(b.title)}</span>
            </a>`).join('');
  return `
<div class="container">
    <h2 class="section-title">From the Spice Guide</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function renderRecipe(r, allRecipes, productBySlug, blogPosts, template) {
  const title = escapeHtml((r.seo && r.seo.title) || `${r.title} Recipe | Mom Masale`);
  const metaDesc = escapeHtml((r.seo && r.seo.metaDescription) || r.description || '');
  const keywords = escapeHtml((r.seo && r.seo.keywords || []).join(', '));
  const canonical = `${SITE_URL}/recipes/${r.slug}`;
  const schemaJson = JSON.stringify(buildRecipeSchema(r), null, 2);
  const totalMinutes = isoDurationToMinutes(r.prepTime) + isoDurationToMinutes(r.cookTime);

  const replacements = {
    '{{TITLE}}': title,
    '{{META_DESCRIPTION}}': metaDesc,
    '{{KEYWORDS}}': keywords,
    '{{CANONICAL_URL}}': canonical,
    '{{RECIPE_SCHEMA_JSON}}': schemaJson,
    '{{RECIPE_BREADCRUMB_JSON}}': JSON.stringify(buildRecipeBreadcrumbSchema(r), null, 2),
    '{{RECIPE_TITLE}}': escapeHtml(r.title),
    '{{RECIPE_CATEGORY}}': escapeHtml(r.category || ''),
    '{{RECIPE_CUISINE}}': escapeHtml(r.cuisine || ''),
    '{{RECIPE_DESCRIPTION}}': escapeHtml(r.description || ''),
    '{{RECIPE_IMAGE}}': escapeHtml(r.image),
    '{{RECIPE_IMAGE_ALT}}': escapeHtml(r.imageAlt || r.title),
    '{{RECIPE_PREP_MIN}}': String(isoDurationToMinutes(r.prepTime)),
    '{{RECIPE_COOK_MIN}}': String(isoDurationToMinutes(r.cookTime)),
    '{{RECIPE_TOTAL_MIN}}': String(totalMinutes),
    '{{RECIPE_SERVINGS}}': String(r.servings || ''),
    '{{RECIPE_INGREDIENTS_LIST}}': buildIngredientsHtml(r, productBySlug),
    '{{RECIPE_STEPS_LIST}}': buildStepsHtml(r),
    '{{RECIPE_SHOP_INGREDIENTS_BLOCK}}': buildShopIngredientsHtml(r, productBySlug),
    '{{RECIPE_RELATED_BLOG_BLOCK}}': buildRelatedBlogForRecipeHtml(r, blogPosts),
    '{{RECIPE_RELATED_BLOCK}}': buildRelatedRecipesForRecipeHtml(r, allRecipes),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

// ── BLOG rendering ────────────────────────────────────────

function buildBlogSchema(b) {
  if (b.category === 'FAQs') {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{
        '@type': 'Question',
        name: b.title,
        acceptedAnswer: { '@type': 'Answer', text: (b.body || []).join(' ') },
      }],
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: b.title,
    image: [`${SITE_URL}/${b.image}`],
    description: b.description || b.title,
    articleSection: b.category,
    author: { '@type': 'Organization', name: 'Mom Masale' },
    publisher: { '@type': 'Organization', name: 'Mom Masale' },
  };
}

function buildBlogBreadcrumbSchema(b) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Spice Guide', item: `${SITE_URL}/spice-guide.html` },
      { '@type': 'ListItem', position: 3, name: b.title, item: `${SITE_URL}/guide/${b.slug}.html` },
    ],
  };
}

function buildBlogBodyHtml(b) {
  return (b.body || []).map(p => `<p>${escapeHtml(p)}</p>`).join('\n            ');
}

function buildRelatedProductsForBlogHtml(b, productBySlug) {
  const slugs = [...new Set(b.relatedProducts || [])].sort();
  if (!slugs.length) return '';
  const cards = slugs.map(slug => {
    const p = productBySlug.get(slug);
    if (!p) return '';
    return `
            <a class="related-card" href="../products/${p.slug}.html">
                <img src="../${p.image}" alt="${escapeHtml(p.imageAlt || p.name)}" loading="lazy" width="160" height="160">
                <span>${escapeHtml(p.name)}</span>
            </a>`;
  }).join('');
  return `
<div class="container">
    <h2 class="section-title">Shop the Ingredients</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function buildRelatedRecipesForBlogHtml(b, recipeBySlug) {
  const slugs = [...new Set(b.relatedRecipes || [])].sort();
  if (!slugs.length) return '';
  const cards = slugs.map(slug => {
    const r = recipeBySlug.get(slug);
    if (!r) return '';
    return `
            <a class="related-card recipe-related-card" href="../recipes/${r.slug}.html">
                <img src="../${r.image}" alt="${escapeHtml(r.imageAlt || r.title)}" loading="lazy" width="160" height="160"
                    onerror="this.src='https://placehold.co/160x160/7b1120/fff?text=${encodeURIComponent(r.title)}'">
                <span>${escapeHtml(r.title)}</span>
            </a>`;
  }).join('');
  return `
<div class="container">
    <h2 class="section-title">Related Recipes</h2>
    <div class="related-grid">${cards}
    </div>
</div>`;
}

function renderBlog(b, productBySlug, recipeBySlug, template) {
  const title = escapeHtml((b.seo && b.seo.title) || `${b.title} | Mom Masale`);
  const metaDesc = escapeHtml((b.seo && b.seo.metaDescription) || b.description || '');
  const keywords = escapeHtml((b.seo && b.seo.keywords || []).join(', '));
  const canonical = `${SITE_URL}/guide/${b.slug}.html`;
  const schemaJson = JSON.stringify(buildBlogSchema(b), null, 2);

  const replacements = {
    '{{TITLE}}': title,
    '{{META_DESCRIPTION}}': metaDesc,
    '{{KEYWORDS}}': keywords,
    '{{CANONICAL_URL}}': canonical,
    '{{BLOG_SCHEMA_JSON}}': schemaJson,
    '{{BLOG_BREADCRUMB_JSON}}': JSON.stringify(buildBlogBreadcrumbSchema(b), null, 2),
    '{{BLOG_TITLE}}': escapeHtml(b.title),
    '{{BLOG_CATEGORY}}': escapeHtml(b.category || ''),
    '{{BLOG_DESCRIPTION}}': escapeHtml(b.description || ''),
    '{{BLOG_IMAGE}}': escapeHtml(b.image),
    '{{BLOG_IMAGE_ALT}}': escapeHtml(b.imageAlt || b.title),
    '{{BLOG_BODY_HTML}}': buildBlogBodyHtml(b),
    '{{BLOG_RELATED_PRODUCTS_BLOCK}}': buildRelatedProductsForBlogHtml(b, productBySlug),
    '{{BLOG_RELATED_RECIPES_BLOCK}}': buildRelatedRecipesForBlogHtml(b, recipeBySlug),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  return html;
}

// ── sitemap ──────────────────────────────────────────────
function buildSitemap(products, recipes, blogPosts, lastmodMap) {
  const urls = STATIC_PAGES.map(pg => {
    const lastmod = gitLastmod(pg.file);
    return `  <url><loc>${SITE_URL}${pg.loc}</loc><lastmod>${lastmod}</lastmod><priority>${pg.priority}</priority></url>`;
  });
  products
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach(p => {
      const lastmod = lastmodMap[`product:${p.slug}`].lastmod;
      urls.push(`  <url><loc>${SITE_URL}/products/${p.slug}</loc><lastmod>${lastmod}</lastmod><priority>0.75</priority></url>`);
    });
  recipes
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach(r => {
      const lastmod = lastmodMap[`recipe:${r.slug}`].lastmod;
      urls.push(`  <url><loc>${SITE_URL}/recipes/${r.slug}.html</loc><lastmod>${lastmod}</lastmod><priority>0.7</priority></url>`);
    });
  blogPosts
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .forEach(b => {
      const lastmod = lastmodMap[`blog:${b.slug}`].lastmod;
      urls.push(`  <url><loc>${SITE_URL}/guide/${b.slug}.html</loc><lastmod>${lastmod}</lastmod><priority>0.65</priority></url>`);
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ── generic generated-file sync (shared by both collections) ─

function syncGeneratedFiles(outputDir, manifestPath, currentSlugs, label) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const previousManifest = fs.existsSync(manifestPath) ? readJSON(manifestPath) : { files: [] };
  let removedCount = 0;
  previousManifest.files.forEach(fname => {
    const slug = fname.replace(/\.html$/, '');
    if (!currentSlugs.has(slug)) {
      const stalePath = path.join(outputDir, fname);
      if (fs.existsSync(stalePath)) {
        fs.unlinkSync(stalePath);
        removedCount++;
        console.log(`  removed stale ${label} page: ${path.basename(outputDir)}/${fname}`);
      }
    }
  });
  return removedCount;
}

// ── main ─────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(PRODUCTS_DATA_PATH)) throw new Error(`Cannot find ${PRODUCTS_DATA_PATH}.`);
  if (!fs.existsSync(RECIPES_DATA_PATH)) throw new Error(`Cannot find ${RECIPES_DATA_PATH}.`);
  if (!fs.existsSync(BLOG_DATA_PATH)) throw new Error(`Cannot find ${BLOG_DATA_PATH}.`);
  if (!fs.existsSync(PRODUCT_TEMPLATE_PATH)) throw new Error(`Cannot find ${PRODUCT_TEMPLATE_PATH}.`);
  if (!fs.existsSync(RECIPE_TEMPLATE_PATH)) throw new Error(`Cannot find ${RECIPE_TEMPLATE_PATH}.`);
  if (!fs.existsSync(BLOG_TEMPLATE_PATH)) throw new Error(`Cannot find ${BLOG_TEMPLATE_PATH}.`);

  const products = readJSON(PRODUCTS_DATA_PATH);
  const recipes = readJSON(RECIPES_DATA_PATH);
  const blogPosts = readJSON(BLOG_DATA_PATH);

  validateProducts(products);
  const productSlugSet = new Set(products.map(p => p.slug));
  validateRecipes(recipes, productSlugSet);
  const recipeSlugSet = new Set(recipes.map(r => r.slug));
  validateBlog(blogPosts, productSlugSet, recipeSlugSet);

  const productBySlug = new Map(products.map(p => [p.slug, p]));
  const recipeBySlug = new Map(recipes.map(r => [r.slug, r]));

  const productTemplate = fs.readFileSync(PRODUCT_TEMPLATE_PATH, 'utf8');
  const recipeTemplate = fs.readFileSync(RECIPE_TEMPLATE_PATH, 'utf8');
  const blogTemplate = fs.readFileSync(BLOG_TEMPLATE_PATH, 'utf8');

  // ── products ──
  const currentProductSlugs = new Set(products.map(p => p.slug));
  const removedProducts = syncGeneratedFiles(PRODUCTS_OUTPUT_DIR, PRODUCTS_MANIFEST_PATH, currentProductSlugs, 'product');

  const sortedProducts = products.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  sortedProducts.forEach(p => {
    const html = renderProduct(p, products, recipes, blogPosts, productTemplate);
    fs.writeFileSync(path.join(PRODUCTS_OUTPUT_DIR, `${p.slug}.html`), html, 'utf8');
  });
  fs.writeFileSync(PRODUCTS_MANIFEST_PATH, JSON.stringify({ files: sortedProducts.map(p => `${p.slug}.html`) }, null, 2) + '\n', 'utf8');

  // ── recipes ──
  const currentRecipeSlugs = new Set(recipes.map(r => r.slug));
  const removedRecipes = syncGeneratedFiles(RECIPES_OUTPUT_DIR, RECIPES_MANIFEST_PATH, currentRecipeSlugs, 'recipe');

  const sortedRecipes = recipes.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  sortedRecipes.forEach(r => {
    const html = renderRecipe(r, recipes, productBySlug, blogPosts, recipeTemplate);
    fs.writeFileSync(path.join(RECIPES_OUTPUT_DIR, `${r.slug}.html`), html, 'utf8');
  });
  fs.writeFileSync(RECIPES_MANIFEST_PATH, JSON.stringify({ files: sortedRecipes.map(r => `${r.slug}.html`) }, null, 2) + '\n', 'utf8');

  // ── blog / spice guide ──
  const currentBlogSlugs = new Set(blogPosts.map(b => b.slug));
  const removedBlog = syncGeneratedFiles(BLOG_OUTPUT_DIR, BLOG_MANIFEST_PATH, currentBlogSlugs, 'blog');

  const sortedBlog = blogPosts.slice().sort((a, b) => a.slug.localeCompare(b.slug));
  sortedBlog.forEach(b => {
    const html = renderBlog(b, productBySlug, recipeBySlug, blogTemplate);
    fs.writeFileSync(path.join(BLOG_OUTPUT_DIR, `${b.slug}.html`), html, 'utf8');
  });
  fs.writeFileSync(BLOG_MANIFEST_PATH, JSON.stringify({ files: sortedBlog.map(b => `${b.slug}.html`) }, null, 2) + '\n', 'utf8');

  // ── lastmod tracking ──
  const prevLastmodCache = loadLastmodCache();
  const productLastmods = computeLastmods(products, prevLastmodCache, 'product:');
  const recipeLastmods = computeLastmods(recipes, prevLastmodCache, 'recipe:');
  const blogLastmods = computeLastmods(blogPosts, prevLastmodCache, 'blog:');
  const lastmodMap = { ...productLastmods, ...recipeLastmods, ...blogLastmods };
  fs.writeFileSync(LASTMOD_CACHE_PATH, JSON.stringify(lastmodMap, null, 2) + '\n', 'utf8');

  // ── sitemap (covers all collections + static pages) ──
  fs.writeFileSync(SITEMAP_PATH, buildSitemap(products, recipes, blogPosts, lastmodMap), 'utf8');

  console.log(`\nDone.`);
  console.log(`  products: generated ${sortedProducts.length}, removed ${removedProducts} stale`);
  console.log(`  recipes:  generated ${sortedRecipes.length}, removed ${removedRecipes} stale`);
  console.log(`  blog:     generated ${sortedBlog.length}, removed ${removedBlog} stale`);
  console.log(`  sitemap.xml rebuilt (${STATIC_PAGES.length + products.length + recipes.length + blogPosts.length} URLs)`);
}

try {
  main();
} catch (err) {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
}