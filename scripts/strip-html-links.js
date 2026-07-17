#!/usr/bin/env node
'use strict';
/**
 * Mom Masale — Clean URL Migration
 * ----------------------------------
 * One-time (but safely re-runnable) migration that strips ".html" from every
 * INTERNAL page link across the site, so URLs match what Cloudflare Pages
 * actually serves (clean URLs, no trailing slash — see assumption below).
 *
 * SAFE BY DESIGN:
 *   - Only touches hrefs/URLs matching a known, finite list of page names
 *     (the site's actual pages) plus the dynamic products/{slug} and
 *     recipes/{slug} patterns. It does NOT do a blind ".html" -> "" replace.
 *   - Never touches: css/js asset references (style.min.css, main.min.js),
 *     data/*.json fetches, external URLs (wa.me, instagram.com, etc.),
 *     or file-system paths used by build-site.js / minify-assets.js.
 *   - Idempotent: running it twice is a no-op the second time.
 *
 * ASSUMPTION: Cloudflare Pages is serving clean URLs with NO trailing slash
 * (i.e. /products, not /products/). If your Pages project's "Trailing Slash"
 * setting is "Always", stop and tell Claude before running this — the
 * replacement targets would need a trailing slash instead.
 *
 * Does NOT touch: scripts/build-site.js, scripts/minify-assets.js,
 * scripts/optimize-images.js, package.json, wrangler.toml, functions/**.
 * Those get hand-edited separately so future rebuilds emit clean URLs too.
 *
 * Usage:
 *   node scripts/strip-html-links.js            # apply changes
 *   node scripts/strip-html-links.js --dry-run  # preview only, no writes
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ── every real top-level page on the site (filename without .html) ──
const TOP_LEVEL_PAGES = [
  'index', 'products', 'recipes', 'guide', 'about', 'contact',
  'account', 'checkout', 'order-confirmation', '404', 'admin', 'bulk-orders',
];

// ── static files to migrate (top-level pages + templates) ──
const STATIC_HTML_FILES = [
  'index.html', 'products.html', 'recipes.html', 'about.html', 'contact.html',
  'account.html', 'checkout.html', 'order-confirmation.html', '404.html',
  'admin.html', 'bulk-orders.html',
  'scripts/product-template.html', 'scripts/recipe-template.html', 'scripts/guide-template.html',
];

const JS_FILES = ['js/main.js', 'js/account.js', 'js/checkout.js'];

const SITEMAP_FILE = 'sitemap.xml';

function collectGeneratedPages(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(dir, f));
}

// ── build the list of (pattern, replacement) rules ──
function buildRules() {
  const rules = [];

  // 1. Root-relative top-level links: href="products.html" -> href="products"
  //    href="index.html" -> href="/" ; href="../index.html" -> href="../"
  TOP_LEVEL_PAGES.forEach(page => {
    // prefix is one of: "../" (one level up), "/" (absolute root), or nothing (same dir)
    rules.push({
      pattern: new RegExp(`([("'\`])(\\.\\./|/)?${page}\\.html(#[\\w-]*|\\?[^"'\`)\\s]*)?([)"'\`])`, 'g'),
      replace: (match, open, prefix, tail, close) => {
        let base;
        if (page === 'index') {
          base = prefix === '../' ? '../' : '/';
        } else {
          base = prefix === '../' ? `../${page}` : prefix === '/' ? `/${page}` : page;
        }
        return `${open}${base}${tail || ''}${close}`;
      },
    });
  });

  // 2. Dynamic product/recipe detail links, both from root and from
  //    within /products/ or /recipes/ (../products/slug.html, products/slug.html)
  rules.push({
    pattern: /([("'`])((?:\.\.\/)?products\/[\w-]+)\.html(#[\w-]*|\?[^"'`)\s]*)?([)"'`])/g,
    replace: (m, open, base, tail, close) => `${open}${base}${tail || ''}${close}`,
  });
  rules.push({
    pattern: /([("'`])((?:\.\.\/)?recipes\/[\w-]+)\.html(#[\w-]*|\?[^"'`)\s]*)?([)"'`])/g,
    replace: (m, open, base, tail, close) => `${open}${base}${tail || ''}${close}`,
  });
  rules.push({
    pattern: /([("'`])((?:\.\.\/)?guide\/[\w-]+)\.html(#[\w-]*|\?[^"'`)\s]*)?([)"'`])/g,
    replace: (m, open, base, tail, close) => `${open}${base}${tail || ''}${close}`,
  });

  // 3. Template-literal dynamic links used in JS: `products/${p.slug}.html`
  rules.push({
    pattern: /(products\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(recipes\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(guide\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(\.\.\/products\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(\.\.\/recipes\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(\.\.\/guide\/\$\{[^}]+\})\.html/g,
    replace: (m, base) => base,
  });

  // 4. Absolute canonical / og:url / JSON-LD URLs: https://mommasale.com/products.html
  TOP_LEVEL_PAGES.forEach(page => {
    if (page === 'index') return; // canonical for home is already "/"
    rules.push({
      pattern: new RegExp(`(https://mommasale\\.com/)${page}\\.html`, 'g'),
      replace: (m, prefix) => `${prefix}${page}`,
    });
  });
  rules.push({
    pattern: /(https:\/\/mommasale\.com\/products\/[\w-]+)\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(https:\/\/mommasale\.com\/recipes\/[\w-]+)\.html/g,
    replace: (m, base) => base,
  });
  rules.push({
    pattern: /(https:\/\/mommasale\.com\/guide\/[\w-]+)\.html/g,
    replace: (m, base) => base,
  });

  // 5. Sitemap <loc> tags (covers products/recipes + static pages)
  rules.push({
    pattern: /(<loc>https:\/\/mommasale\.com\/[^<]*?)\.html(<\/loc>)/g,
    replace: (m, base, close) => `${base}${close}`,
  });

  return rules;
}

// Bare same-directory sibling links only occur inside generated products/*.html
// and recipes/*.html (e.g. products/turmeric-powder.html linking to
// href="red-chilli-powder.html"). Scoped narrowly to href="..." so it can't
// accidentally catch anything else.
const BARE_SIBLING_RULE = {
  pattern: /href="([\w-]+)\.html"/g,
  replace: (m, slug) => `href="${slug}"`,
};

function migrateFile(relPath, rules) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  (skip) ${relPath} — not found`);
    return { changed: false };
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  let updated = original;
  rules.forEach(rule => {
    updated = updated.replace(rule.pattern, rule.replace);
  });

  if (updated === original) {
    console.log(`  ${relPath}: no changes needed`);
    return { changed: false };
  }

  const diffCount = (original.match(/\.html/g) || []).length - (updated.match(/\.html/g) || []).length;
  console.log(`  ${relPath}: ${diffCount} internal .html reference(s) stripped${DRY_RUN ? ' (dry-run, not written)' : ''}`);

  if (!DRY_RUN) fs.writeFileSync(fullPath, updated, 'utf8');
  return { changed: true };
}

function main() {
  const rules = buildRules();
  let totalChanged = 0;

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no files will be written)' : 'LIVE — writing changes'}\n`);

  console.log('Static pages + templates:');
  STATIC_HTML_FILES.forEach(f => {
    if (migrateFile(f, rules).changed) totalChanged++;
  });

  console.log('\nGenerated product pages:');
  const rulesWithSibling = [...rules, BARE_SIBLING_RULE];
  collectGeneratedPages('products').forEach(f => {
    if (migrateFile(f, rulesWithSibling).changed) totalChanged++;
  });

  console.log('\nGenerated recipe pages:');
  collectGeneratedPages('recipes').forEach(f => {
    if (migrateFile(f, rulesWithSibling).changed) totalChanged++;
  });

  console.log('\nGenerated guide pages:');
  collectGeneratedPages('guide').forEach(f => {
    if (migrateFile(f, rulesWithSibling).changed) totalChanged++;
  });

  console.log('\nJavaScript source files:');
  JS_FILES.forEach(f => {
    if (migrateFile(f, rules).changed) totalChanged++;
  });

  console.log('\nSitemap:');
  if (migrateFile(SITEMAP_FILE, rules).changed) totalChanged++;

  console.log(`\nDone. ${totalChanged} file(s) ${DRY_RUN ? 'would be' : 'were'} modified.`);
  if (!DRY_RUN) {
    console.log('\nNext steps:');
    console.log('  1. node scripts/minify-assets.js   # regenerate main.min.js from the patched main.js');
    console.log('  2. git diff                         # review every change before committing');
    console.log('  3. Manually apply the build-site.js / template edits (see chat) so future');
    console.log('     rebuilds keep emitting clean URLs — otherwise the next CI run regresses this.');
  }
}

main();
