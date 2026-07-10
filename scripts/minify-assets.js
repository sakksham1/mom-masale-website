#!/usr/bin/env node
'use strict';
/**
 * Mom Masale — Asset Minification
 * ---------------------------------
 * Minifies css/style.css -> css/style.min.css
 *          js/main.js    -> js/main.min.js
 *
 * Source files (style.css, main.js) stay as the files you actually edit.
 * This script regenerates the .min versions and rewrites every reference
 * to them across:
 *   - top-level HTML files (index.html, products.html, about.html,
 *     contact.html, recipes.html, 404.html)
 *   - scripts/product-template.html, scripts/recipe-template.html
 *     (relative paths, ../css/ ../js/)
 *
 * Safe to run repeatedly — idempotent, only rewrites .css/.js refs that
 * aren't already pointing at the .min file.
 *
 * Usage:
 *   npm install clean-css terser --save-dev
 *   node scripts/minify-assets.js
 */

const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { minify: minifyJs } = require('terser');

const ROOT = path.resolve(__dirname, '..');

const CSS_SRC = path.join(ROOT, 'css', 'style.css');
const CSS_OUT = path.join(ROOT, 'css', 'style.min.css');
const JS_SRC = path.join(ROOT, 'js', 'main.js');
const JS_OUT = path.join(ROOT, 'js', 'main.min.js');

// Top-level pages use "css/style.css" / "js/main.js";
// templates (one directory deep) use "../css/style.css" / "../js/main.js".
const HTML_FILES = [
  'index.html',
  'products.html',
  'about.html',
  'contact.html',
  'recipes.html',
  '404.html',
  'scripts/product-template.html',
  'scripts/recipe-template.html',
];

async function buildCss() {
  const input = fs.readFileSync(CSS_SRC, 'utf8');
  const output = new CleanCSS({ level: 2 }).minify(input);
  if (output.errors.length) throw new Error(output.errors.join('\n'));
  fs.writeFileSync(CSS_OUT, output.styles, 'utf8');
  const savedKb = ((input.length - output.styles.length) / 1024).toFixed(1);
  console.log(`  css/style.min.css written (${savedKb} KiB saved vs source)`);
}

async function buildJs() {
  const input = fs.readFileSync(JS_SRC, 'utf8');
  const result = await minifyJs(input, { compress: true, mangle: true });
  if (result.error) throw result.error;
  fs.writeFileSync(JS_OUT, result.code, 'utf8');
  const savedKb = ((input.length - result.code.length) / 1024).toFixed(1);
  console.log(`  js/main.min.js written (${savedKb} KiB saved vs source)`);
}

function rewriteRefs(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  (skip) ${relPath} — not found`);
    return;
  }
  let html = fs.readFileSync(fullPath, 'utf8');
  const before = html;

  // href="…css/style.css"  ->  href="…css/style.min.css"  (skip if already .min.css)
  html = html.replace(
    /href="((?:\.\.\/)?css\/style)\.css"/g,
    'href="$1.min.css"'
  );
  // src="…js/main.js"  ->  src="…js/main.min.js"  (skip if already .min.js)
  html = html.replace(
    /src="((?:\.\.\/)?js\/main)\.js"/g,
    'src="$1.min.js"'
  );

  if (html !== before) {
    fs.writeFileSync(fullPath, html, 'utf8');
    console.log(`  ${relPath}: refs updated`);
  } else {
    console.log(`  ${relPath}: already up to date`);
  }
}

async function main() {
  console.log('Minifying assets...');
  await buildCss();
  await buildJs();

  console.log('\nUpdating HTML references...');
  HTML_FILES.forEach(rewriteRefs);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Minify failed:', err.message);
  process.exit(1);
});
