// POST /api/product-core/request   { productId, updates: { ...whitelisted fields } }
//
// manager or admin only — this is the one D1 change that fans out to the
// public website, so it's kept to the two roles closest to the catalog.
//
// `updates` mirrors the exact whitelist PATCH /api/admin/products accepts
// (see admin/products.js onRequestPatch), so a manager's phone edit and an
// admin's direct edit go through identical validation and land in D1 the
// same way once approved. Admins should just call PATCH /api/admin/products
// directly instead of this endpoint — there's no point filing an approval
// request for a change they're already allowed to approve themselves.
//
// Decision + GitHub sync lives in manager/approvals/decide.js.

import { requireRole, forbidden, jsonError } from '../_utils/admin.js';
import { createNotification } from '../_utils/notify.js';

const SCALAR_FIELDS = [
  'name', 'category', 'image', 'imageAlt',
  'amazonUrl', 'flipkartUrl', 'meeshoUrl',
  'comingSoon', 'featured', 'bestseller', 'newArrival',
];
const SEO_FIELDS = ['title', 'metaDescription', 'shortDescription', 'longDescription', 'keywords'];

function summarize(productName, updates) {
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['manager', 'admin']);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { productId, updates } = body;
  if (!Number.isInteger(productId)) return jsonError('productId is required');
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return jsonError('updates object is required');
  }

  const allowedKeys = new Set([...SCALAR_FIELDS, 'seo', 'prices']);
  const unknownKeys = Object.keys(updates).filter(k => !allowedKeys.has(k));
  if (unknownKeys.length) return jsonError(`Unsupported field(s): ${unknownKeys.join(', ')}`);
  if (Object.keys(updates).length === 0) return jsonError('No changes provided');

  if (updates.seo) {
    if (typeof updates.seo !== 'object') return jsonError('seo must be an object');
    const seoUnknown = Object.keys(updates.seo).filter(k => !SEO_FIELDS.includes(k));
    if (seoUnknown.length) return jsonError(`Unsupported SEO field(s): ${seoUnknown.join(', ')}`);
  }
  if (updates.prices) {
    if (typeof updates.prices !== 'object') return jsonError('prices must be an object');
    for (const [size, price] of Object.entries(updates.prices)) {
      if (!Number.isFinite(price) || price <= 0) return jsonError(`Invalid price for size "${size}"`);
    }
  }

  const product = await env.DB.prepare('SELECT id, slug, name FROM products WHERE id = ?').bind(productId).first();
  if (!product) return jsonError('Product not found', 404);

  // field is a fixed constant now (schema kept as-is — no migration needed).
  // payload carries the whole `updates` object as JSON.
  const result = await env.DB.prepare(
    `INSERT INTO product_core_change_requests (product_id, field, payload, requested_by) VALUES (?, 'update', ?, ?)`
  ).bind(productId, JSON.stringify(updates), user.id).run();

  context.waitUntil(createNotification(env, {
    type: 'approval_requested',
    title: 'Product change pending',
    body: `${summarize(product.name, updates)} — requested by ${user.name}`,
    referenceType: 'product_core',
    referenceId: result.meta.last_row_id,
  }));

  return new Response(JSON.stringify({ ok: true, requestId: result.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}
