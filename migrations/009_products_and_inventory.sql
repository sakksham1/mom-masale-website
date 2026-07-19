

CREATE TABLE products (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL,
  image                TEXT NOT NULL,
  image_alt            TEXT,
  amazon_url           TEXT,
  flipkart_url         TEXT,
  meesho_url           TEXT,
  coming_soon          INTEGER NOT NULL DEFAULT 0,
  featured             INTEGER NOT NULL DEFAULT 0,
  bestseller           INTEGER NOT NULL DEFAULT 0,
  new_arrival          INTEGER NOT NULL DEFAULT 0,
  seo_title            TEXT,
  seo_meta_description TEXT,
  seo_short_description TEXT,
  seo_long_description  TEXT,
  seo_keywords         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_sizes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size         TEXT NOT NULL,
  price        INTEGER NOT NULL,
  stock_qty    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size)
);

CREATE TABLE product_aliases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias        TEXT NOT NULL
);

CREATE TABLE product_faq (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_related (
  product_id         INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  related_product_id INTEGER NOT NULL,
  PRIMARY KEY (product_id, related_product_id)
);

CREATE TABLE inventory_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size           TEXT NOT NULL,
  change_qty     INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  reference_type TEXT,
  reference_id   INTEGER,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_product_sizes_product_id ON product_sizes(product_id);
CREATE INDEX idx_inventory_movements_product_id ON inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_reference ON inventory_movements(reference_type, reference_id);
