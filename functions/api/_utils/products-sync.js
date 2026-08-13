// functions/api/_utils/products-sync.js
//
// D1 is the source of truth for products (see migrations/0002_products_and_inventory.sql).
// data/products.json in GitHub is now a GENERATED artifact, same as products/*.html —
// call syncProductsToGitHub() after any catalog write so generate-site.yml picks it up.
//
// Deliberately does NOT include stock — stock changes far more often than
// catalog data and shouldn't cause a git commit + Pages rebuild on every sale.
// Stock lives in D1 only; see admin/inventory/adjust.js.

import { readRepoFile, writeRepoFile } from './github.js';

function groupBy(rows, key) {
  const out = {};
  for (const row of rows) {
    (out[row[key]] ||= []).push(row);
  }
  return out;
}

// First-name + last-initial for public display — avoids exposing a
// reviewer's full name in JSON-LD that ships to every visitor/crawler.
function shortAuthorName(fullName) {
  const parts = String(fullName || 'Customer').trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export async function buildProductsJsonArray(env) {
  const [products, sizes, aliases, faqs, related, reviewAgg, topReviews, galleryImages] = await Promise.all([
    env.DB.prepare('SELECT * FROM products ORDER BY slug').all(),
    env.DB.prepare('SELECT * FROM product_sizes ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM product_aliases ORDER BY product_id, id').all(),
    env.DB.prepare('SELECT * FROM product_faq ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM product_related').all(),
    env.DB.prepare(`SELECT product_id, COUNT(*) as cnt, AVG(rating) as avg_rating FROM product_reviews WHERE status = 'approved' GROUP BY product_id`).all(),
    env.DB.prepare(`SELECT pr.product_id, pr.rating, pr.body, pr.created_at, u.name as author_name FROM product_reviews pr JOIN users u ON u.id = pr.user_id WHERE pr.status = 'approved' ORDER BY pr.product_id, pr.created_at DESC`).all(),
    env.DB.prepare('SELECT * FROM product_images ORDER BY product_id, sort_order, id').all(),
  ]);

  const productRows = products.results || [];
  const slugById = new Map(productRows.map(p => [p.id, p.slug]));
  const sizesByProduct = groupBy(sizes.results || [], 'product_id');
  const aliasesByProduct = groupBy(aliases.results || [], 'product_id');
  const faqByProduct = groupBy(faqs.results || [], 'product_id');
  const relatedByProduct = groupBy(related.results || [], 'product_id');
  const galleryByProduct = groupBy(galleryImages.results || [], 'product_id');

  const ratingByProduct = new Map(
    (reviewAgg.results || []).map(r => [r.product_id, { reviewCount: r.cnt, ratingValue: Math.round(r.avg_rating * 10) / 10 }])
  );
  const MAX_REVIEWS_IN_SCHEMA = 5;
  const reviewsByProduct = new Map();
  for (const r of topReviews.results || []) {
    const list = reviewsByProduct.get(r.product_id) || [];
    if (list.length < MAX_REVIEWS_IN_SCHEMA) {
      list.push({
        rating: r.rating,
        body: r.body,
        authorName: shortAuthorName(r.author_name),
        datePublished: String(r.created_at).slice(0, 10),
      });
    }
    reviewsByProduct.set(r.product_id, list);
  }

  return productRows.map(p => {
    const productSizes = sizesByProduct[p.id] || [];
    const prices = {};
    productSizes.forEach(s => { prices[s.size] = s.price; });
    const gallery = (galleryByProduct[p.id] || []).map(g => ({
      path: g.image,
      alt: g.alt || `Mom Masale ${p.name}`,
    }));
    const images = [{ path: p.image, alt: p.image_alt || `Mom Masale ${p.name} retail pack` }, ...gallery];

    return {
      name: p.name,
      category: p.category,
      sizes: productSizes.map(s => s.size),
      prices,
      image: p.image,
      images,
      amazon: p.amazon_url || '#',
      flipkart: p.flipkart_url || '#',
      meesho: p.meesho_url || '#',
      aliases: (aliasesByProduct[p.id] || []).map(a => a.alias),
      slug: p.slug,
      imageAlt: p.image_alt || `Mom Masale ${p.name} retail pack`,
      featured: !!p.featured,
      bestseller: !!p.bestseller,
      newArrival: !!p.new_arrival,
      comingSoon: !!p.coming_soon,
      seo: {
        title: p.seo_title || '',
        metaDescription: p.seo_meta_description || '',
        shortDescription: p.seo_short_description || '',
        longDescription: p.seo_long_description || '',
        keywords: p.seo_keywords ? JSON.parse(p.seo_keywords) : [],
      },
      faq: (faqByProduct[p.id] || []).map(f => ({ question: f.question, answer: f.answer })),
      relatedProducts: (relatedByProduct[p.id] || [])
        .map(r => slugById.get(r.related_product_id))
        .filter(Boolean),
      // Omitted entirely (not even a zeroed object) until the first review
      // is approved — buildProductSchema() in build-site.js only emits
      // aggregateRating/review when these are present.
      ...(ratingByProduct.has(p.id) ? { aggregateRating: ratingByProduct.get(p.id) } : {}),
      ...(reviewsByProduct.has(p.id) ? { reviews: reviewsByProduct.get(p.id) } : {}),
    };
  });
}

// Commits the current D1 catalog state to data/products.json. The push
// triggers generate-site.yml exactly as if this file had been hand-edited.
export async function syncProductsToGitHub(env, commitMessage) {
  const jsonArray = await buildProductsJsonArray(env);
  const newContent = JSON.stringify(jsonArray, null, 2) + '\n';
  const { sha } = await readRepoFile(env, 'data/products.json');
  await writeRepoFile(env, 'data/products.json', newContent, sha, commitMessage);
}
