-- migrations/023_site_themes.sql

CREATE TABLE IF NOT EXISTS site_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,              -- e.g. 'diwali-2026'
  name TEXT NOT NULL,                    -- 'Diwali'
  is_active INTEGER NOT NULL DEFAULT 0,

  -- palette overrides (JSON: {maroon, maroonDark, gold, goldLight, cream, creamDark})
  colors TEXT NOT NULL DEFAULT '{}',

  -- copy overrides
  featured_section_title TEXT,           -- "Featured Products" -> "Diwali Specials"
  promo_banner_text TEXT,                -- top strip override
  hero_title TEXT,
  hero_cta_label TEXT,
  hero_cta_url TEXT,
  hero_image TEXT,

  -- popup banner overlay (products page)
  banner_enabled INTEGER NOT NULL DEFAULT 0,
  banner_title TEXT,
  banner_body TEXT,
  banner_image TEXT,
  banner_cta_label TEXT,
  banner_cta_url TEXT,

  -- commercial
  discount_percent INTEGER,              -- overrides commerce.discountPercent when active
  coupon_code TEXT,                      -- display-only "use code X" badge, not yet validated server-side

  -- scheduling metadata (not auto-enforced yet)
  starts_at TEXT,
  ends_at TEXT,

  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only one theme can be active at a time — enforced at the DB level as a
-- safety net; the activate endpoint also does this transactionally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_themes_one_active
  ON site_themes(is_active) WHERE is_active = 1;