// functions/api/admin/export/products.js
// GET /api/admin/export/products?format=csv|json
//
// Same visibility as GET /api/admin/products (admin, manager, warehouser,
// packaging) — this reuses that endpoint's exact query/grouping shape
// rather than forking it, so the two can never drift.
 
import { requireRole, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { toCsv, csvResponse, jsonDownloadResponse, exportFilename } from '../../_utils/export.js';
 
export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, ok } = await requireRole(request, env, ['admin', 'manager', 'warehouser', 'packaging']);
  if (!ok) return forbidden();
 
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  if (!['csv', 'json'].includes(format)) return jsonError('format must be csv or json');
 
  const [products, sizes, aliases, faqs, related] = await Promise.all([
    env.DB.prepare('SELECT * FROM products ORDER BY name').all(),
    env.DB.prepare('SELECT * FROM product_sizes ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare('SELECT * FROM product_aliases ORDER BY product_id, id').all(),
    env.DB.prepare('SELECT * FROM product_faq ORDER BY product_id, sort_order, id').all(),
    env.DB.prepare(
      `SELECT pr.product_id, p.slug FROM product_related pr JOIN products p ON p.id = pr.related_product_id`
    ).all(),
  ]);
 
  const group = (rows, key) => rows.reduce((acc, r) => ((acc[r[key]] ||= []).push(r), acc), {});
  const sizesByProduct = group(sizes.results || [], 'product_id');
  const aliasesByProduct = group(aliases.results || [], 'product_id');
  const faqByProduct = group(faqs.results || [], 'product_id');
  const relatedByProduct = group(related.results || [], 'product_id');
 
  const rows = (products.results || []).map(p => ({
    ...p,
    sizes: (sizesByProduct[p.id] || []).map(s => ({ size: s.size, price: s.price, stock_qty: s.stock_qty })),
    aliases: (aliasesByProduct[p.id] || []).map(a => a.alias),
    faq: (faqByProduct[p.id] || []).map(f => ({ question: f.question, answer: f.answer })),
    related_products: (relatedByProduct[p.id] || []).map(r => r.slug),
  }));
 
  context.waitUntil(logAudit(env, {
    userId: user.id, action: 'export', resource: 'products',
    diff: { format, rowCount: rows.length },
  }));
 
  if (format === 'json') {
    return jsonDownloadResponse({ products: rows }, exportFilename('products', 'json'));
  }
 
  // CSV: one row per size, since a product can carry multiple sizes/prices.
  // Sizeless (comingSoon) products still get one row with blank size fields.
  const flatRows = [];
  for (const p of rows) {
    const sizeList = p.sizes.length ? p.sizes : [{ size: '', price: '', stock_qty: '' }];
    for (const s of sizeList) {
      flatRows.push({
        slug: p.slug, name: p.name, category: p.category, image: p.image,
        size: s.size, price: s.price, stock_qty: s.stock_qty,
        coming_soon: p.coming_soon ? 1 : 0, featured: p.featured ? 1 : 0,
        bestseller: p.bestseller ? 1 : 0, new_arrival: p.new_arrival ? 1 : 0,
        aliases: JSON.stringify(p.aliases), faq: JSON.stringify(p.faq),
        related_products: JSON.stringify(p.related_products),
      });
    }
  }
  const columns = [
    { key: 'slug', header: 'Slug' }, { key: 'name', header: 'Name' },
    { key: 'category', header: 'Category' }, { key: 'image', header: 'Image' },
    { key: 'size', header: 'Size' }, { key: 'price', header: 'Price' },
    { key: 'stock_qty', header: 'Stock Qty' }, { key: 'coming_soon', header: 'Coming Soon' },
    { key: 'featured', header: 'Featured' }, { key: 'bestseller', header: 'Bestseller' },
    { key: 'new_arrival', header: 'New Arrival' }, { key: 'aliases', header: 'Aliases' },
    { key: 'faq', header: 'FAQ' }, { key: 'related_products', header: 'Related Products' },
  ];
  return csvResponse(toCsv(flatRows, columns), exportFilename('products', 'csv'));
}