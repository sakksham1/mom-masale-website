// GET /api/staff/products — lightweight product+size list for internal
// roles (packaging, warehouser, salesperson, manager, admin). Reads D1
// only — never calls GitHub — so staff usage doesn't compete with the
// admin catalog editor's rate limits.

import { requireRole, forbidden } from '../_utils/admin.js';

const ROLES = ['packaging', 'warehouser', 'salesperson', 'manager', 'admin'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const { ok } = await requireRole(request, env, ROLES);
  if (!ok) return forbidden();

  const products = await env.DB.prepare(
    `SELECT id, slug, name, image FROM products ORDER BY name`
  ).all();

  const sizes = await env.DB.prepare(
    `SELECT product_id, size, price, stock_qty FROM product_sizes ORDER BY sort_order`
  ).all();

  const sizesByProduct = new Map();
  for (const s of sizes.results || []) {
    if (!sizesByProduct.has(s.product_id)) sizesByProduct.set(s.product_id, []);
    sizesByProduct.get(s.product_id).push({ size: s.size, price: s.price, stockQty: s.stock_qty });
  }

  const out = (products.results || []).map(p => ({
    ...p,
    sizes: sizesByProduct.get(p.id) || [],
  }));

  return new Response(JSON.stringify({ products: out }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}