-- `products.image` stays the primary/cover image (cards, OG tags, sitemap).
-- This table holds ADDITIONAL gallery shots only — a product with 1 photo
-- needs zero rows here.
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image TEXT NOT NULL,        -- repo-relative path, e.g. images/products/turmeric-powder-2.webp
  alt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);