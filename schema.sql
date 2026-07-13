-- Mom Masale — D1 schema
-- Run with: wrangler d1 execute mom-masale-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- the session token itself is the primary key
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- nullable: guest checkout stays supported
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',            -- placed / packed / shipped / delivered / cancelled
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'created',    -- created / paid / failed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
