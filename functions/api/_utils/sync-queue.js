// functions/api/_utils/sync-queue.js
// Queue of D1 catalog/review changes awaiting the next explicit "Publish"
// action (POST /api/admin/sync-queue/run), which is what actually calls
// syncProductsToGitHub() and triggers a real commit + site rebuild.
//
// enqueueSync() never throws — a failure to log a queue row must never
// block the underlying D1 write that already succeeded. The next full
// publish rebuilds data/products.json from live D1 state regardless of
// which queue rows exist, so a missed queue entry only affects the
// "what's pending" display, never correctness.

export async function enqueueSync(env, { sourceType, sourceId, productSlug, summary, createdBy }) {
  try {
    await env.DB.prepare(
      `INSERT INTO site_sync_queue (source_type, source_id, product_slug, summary, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(sourceType, sourceId ?? null, productSlug || null, summary, createdBy ?? null).run();
  } catch (err) {
    console.error('enqueueSync failed:', err.message);
  }
}

// Shared human-readable summary builder for product_core catalog updates —
// used by admin/products.js's PATCH, decide.js/decide-batch.js's
// applyProductCoreDecision, and product-core/request.js's notification
// text, so every surface describes the same change the same way.
export function describeCatalogUpdates(productName, updates) {
  const parts = [];
  if (updates.name) parts.push(`rename → "${updates.name}"`);
  if (updates.category) parts.push(`category → ${updates.category}`);
  if (updates.prices) {
    parts.push(...Object.entries(updates.prices).map(([size, price]) => `${size}: ₹${price}`));
  }
  if (updates.image) parts.push('image updated');
  if (updates.seo) parts.push('SEO/description updated');
  if ('comingSoon' in updates) parts.push(updates.comingSoon ? 'marked coming soon' : 'unmarked coming soon');
  if ('featured' in updates) parts.push(updates.featured ? 'marked featured' : 'unmarked featured');
  if ('bestseller' in updates) parts.push(updates.bestseller ? 'marked bestseller' : 'unmarked bestseller');
  if ('newArrival' in updates) parts.push(updates.newArrival ? 'marked new arrival' : 'unmarked new arrival');
  return `${productName} — ${parts.length ? parts.join(', ') : 'catalog update'}`;
}