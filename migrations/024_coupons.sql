-- migrations/024_coupons.sql

CREATE TABLE IF NOT EXISTS site_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,             -- stored uppercase, matched case-insensitively
  description TEXT,
  type TEXT NOT NULL,                    -- 'percent' | 'flat'
  value INTEGER NOT NULL,                -- percent: 1-90, flat: paise-free rupee amount > 0
  max_discount_amount INTEGER,           -- caps a 'percent' discount in rupees; null = uncapped
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER,                   -- total redemptions allowed; null = unlimited
  used_count INTEGER NOT NULL DEFAULT 0, -- atomic counter, guarded on redeem
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  theme_id INTEGER REFERENCES site_themes(id) ON DELETE SET NULL, -- optional: "featured by" a theme
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_site_coupons_active ON site_coupons(is_active);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL REFERENCES site_coupons(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  discount_amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_user ON coupon_redemptions(coupon_id, user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order ON coupon_redemptions(order_id);

ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN coupon_discount_amount INTEGER NOT NULL DEFAULT 0;