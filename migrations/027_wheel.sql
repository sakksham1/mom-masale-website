-- migrations/027_wheel.sql
-- Hero "spice wheel" becomes a modular, multi-mode quick-nav wheel.
-- Each mode owns its own center label / hover teaser / glyph and its own
-- set of wedge items. Tapping the center hub cycles active modes in
-- sort_order — adding a 3rd mode later is a pure data change (insert a
-- row + items), no code change needed.

CREATE TABLE IF NOT EXISTS wheel_modes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,                 -- e.g. 'shop', 'recipes'
  sort_order INTEGER NOT NULL DEFAULT 0,    -- cycle order when tapping the hub
  center_label TEXT NOT NULL,               -- "|" marks a line break, e.g. 'MOM|MASALE'
  center_label_hover TEXT,                  -- teaser shown on hover/focus — describes what tapping leads to
  center_glyph TEXT NOT NULL DEFAULT '✦',
  hub_href TEXT,                            -- informational only now (hub no longer navigates directly)
  is_active INTEGER NOT NULL DEFAULT 1,     -- inactive modes are skipped in the cycle
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wheel_modes_active_order ON wheel_modes(is_active, sort_order);

CREATE TABLE IF NOT EXISTS wheel_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode_id INTEGER NOT NULL REFERENCES wheel_modes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  href TEXT NOT NULL,                       -- relative to site root, e.g. 'products/turmeric-powder'
  color TEXT,                               -- hex; client falls back to a palette color if empty
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wheel_items_mode_order ON wheel_items(mode_id, sort_order);

-- ── seed: Mode 1 — Shop Spices (today's default wheel, unchanged look) ──
INSERT INTO wheel_modes (key, sort_order, center_label, center_label_hover, center_glyph, hub_href, is_active)
VALUES ('shop', 0, 'MOM|MASALE', 'Find Recipes', '✦', 'products', 1);

INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Turmeric', 'products/turmeric-powder', '#d4a017', 0 FROM wheel_modes WHERE key = 'shop';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Red Chilli', 'products/red-chilli-powder', '#ad2b17', 1 FROM wheel_modes WHERE key = 'shop';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Chaat Masala', 'products/chaat-masala', '#7c8b4a', 2 FROM wheel_modes WHERE key = 'shop';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Biryani Masala', 'products/biryani-masala', '#3f6b54', 3 FROM wheel_modes WHERE key = 'shop';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Chai Masala', 'products/chai-masala', '#8b5a2b', 4 FROM wheel_modes WHERE key = 'shop';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Garam Masala', 'products/garam-masala', '#3a2420', 5 FROM wheel_modes WHERE key = 'shop';

-- ── seed: Mode 2 — Recipe finder (the 6 recipes flagged "essentials": true) ──
INSERT INTO wheel_modes (key, sort_order, center_label, center_label_hover, center_glyph, hub_href, is_active)
VALUES ('recipes', 1, 'Looking for a|recipe?', 'Shop Spices', '🍲', 'recipes', 1);

INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Kadak Chai', 'recipes/kadak-masala-chai', '#8b5a2b', 0 FROM wheel_modes WHERE key = 'recipes';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Pani Puri', 'recipes/pani-puri', '#3f6b54', 1 FROM wheel_modes WHERE key = 'recipes';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Veg Biryani', 'recipes/vegetable-biryani', '#ad2b17', 2 FROM wheel_modes WHERE key = 'recipes';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Dal Makhani', 'recipes/dal-makhani', '#3a2420', 3 FROM wheel_modes WHERE key = 'recipes';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Shahi Paneer', 'recipes/shahi-paneer', '#d4a017', 4 FROM wheel_modes WHERE key = 'recipes';
INSERT INTO wheel_items (mode_id, label, href, color, sort_order)
SELECT id, 'Shahi Thandai', 'recipes/shahi-thandai', '#7c8b4a', 5 FROM wheel_modes WHERE key = 'recipes';