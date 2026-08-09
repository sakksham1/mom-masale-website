-- migrations/025_coupon_requests.sql

CREATE TABLE IF NOT EXISTS coupon_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER REFERENCES site_coupons(id) ON DELETE CASCADE, -- null for a 'create' request
  action TEXT NOT NULL,             -- 'create' | 'update'
  payload TEXT NOT NULL,            -- JSON: full create fields, or partial update fields
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coupon_change_requests_status ON coupon_change_requests(status);

-- Add a flag so activate/deactivate lifecycle syncing (below) can tell a
-- theme-linked coupon apart from one that just happens to share a theme_id
-- historically — kept simple: theme_id itself IS the link. No extra column
-- needed, see note in section 2.