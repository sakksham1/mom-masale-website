#!/usr/bin/env node
'use strict';
/**
 * Mom Masale — One-time Image Migration to WebP
 * ------------------------------------------------
 * Converts JPG/PNG source images to WebP at sensible target widths,
 * deletes the original files, and updates every reference across:
 *   - data/products.json   (image field)
 *   - data/recipes.json    (image field)
 *   - index.html           (hero1.jpg .. hero5.jpg backgrounds + preload link)
 *   - about.html           (event1.jpg .. event8.jpg gallery)
 *
 * Favicons / apple-touch-icon / android-chrome icons / site.webmanifest
 * are intentionally left untouched — already tiny, and favicons need
 * broad format support.
 *
 * This is a MIGRATION script, not part of the regular build pipeline.
 * Run it once, review the diff, commit. For new images added later,
 * either save them as .webp directly, or re-run this script (it will
 * just skip any file that's already .webp).
 *
 * Usage:
 *   npm install sharp --save-dev
 *   node scripts/optimize-images.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

// folder -> { maxWidth, quality }
// widths chosen from the largest size each image is actually rendered at
// in the codebase (see card-image / product-detail-card / hero-slider CSS).
const TARGETS = {
  'images/products': { maxWidth: 500, quality: 82 },
  'images/recipes': { maxWidth: 500, quality: 82 },
  'images/hero': { maxWidth: 1600, quality: 75 },
  'images/events': { maxWidth: 500, quality: 80 },
};

const JSON_FILES = ['data/products.json', 'data/recipes.json'];
const HTML_FILES = ['index.html', 'about.html'];

async function convertFolder(relDir, { maxWidth, quality }) {
  const dir = path.join(ROOT, relDir);
  if (!fs.existsSync(dir)) {
    console.log(`  (skip) ${relDir} — folder not found`);
    return { converted: 0, skipped: 0 };
  }

  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f));
  let converted = 0;
  let skipped = 0;

  for (const file of files) {
    const srcPath = path.join(dir, file);
    const baseName = file.replace(/\.(jpe?g|png)$/i, '');
    const destPath = path.join(dir, `${baseName}.webp`);

    if (fs.existsSync(destPath)) {
      console.log(`  (skip) ${relDir}/${file} — ${baseName}.webp already exists`);
      skipped++;
      continue;
    }

    const image = sharp(srcPath);
    const metadata = await image.metadata();
    const resizeWidth = metadata.width && metadata.width > maxWidth ? maxWidth : undefined;

    await image
      .resize(resizeWidth ? { width: resizeWidth } : undefined)
      .webp({ quality })
      .toFile(destPath);

    fs.unlinkSync(srcPath);
    converted++;
    console.log(`  ✓ ${relDir}/${file} -> ${baseName}.webp`);
  }

  return { converted, skipped };
}

function updateJsonRefs(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  (skip) ${relPath} — not found`);
    return 0;
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  let count = 0;
  const updated = original.replace(
    /("image":\s*")([^"]+)\.(jpe?g|png)(")/gi,
    (match, prefix, base, ext, suffix) => {
      count++;
      return `${prefix}${base}.webp${suffix}`;
    }
  );
  if (count > 0) fs.writeFileSync(fullPath, updated, 'utf8');
  console.log(`  ${relPath}: updated ${count} image reference(s)`);
  return count;
}

function updateHtmlRefs(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  (skip) ${relPath} — not found`);
    return 0;
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  let count = 0;
  // Matches images/hero/hero1.jpg, images/events/event1.jpg, etc.
  // Deliberately scoped to the folders we actually converted, so it
  // won't touch favicon/manifest references that live elsewhere.
  const updated = original.replace(
    /(images\/(?:hero|events|products|recipes)\/[a-zA-Z0-9_-]+)\.(jpe?g|png)/gi,
    (match, base, ext) => {
      count++;
      return `${base}.webp`;
    }
  );
  if (count > 0) fs.writeFileSync(fullPath, updated, 'utf8');
  console.log(`  ${relPath}: updated ${count} image reference(s)`);
  return count;
}

async function main() {
  console.log('Converting images to WebP...\n');

  let totalConverted = 0;
  for (const [relDir, opts] of Object.entries(TARGETS)) {
    console.log(`${relDir}:`);
    const { converted } = await convertFolder(relDir, opts);
    totalConverted += converted;
  }

  console.log('\nUpdating JSON references...');
  JSON_FILES.forEach(updateJsonRefs);

  console.log('\nUpdating static HTML references...');
  HTML_FILES.forEach(updateHtmlRefs);

  console.log(`\nDone. Converted ${totalConverted} image(s).`);
  console.log('Next steps:');
  console.log('  1. Run your build script (node scripts/build-site.js) to regenerate product/recipe pages with new paths.');
  console.log('  2. Spot-check a few pages locally (Live Server) to confirm images load.');
  console.log('  3. git diff to review, then commit.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
