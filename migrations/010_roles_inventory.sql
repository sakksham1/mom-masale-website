CREATE TABLE raw_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE raw_material_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  delta REAL NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE packaging_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,
  qty INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id, size, report_date)
);

CREATE TABLE sales_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,
  qty INTEGER NOT NULL,
  sale_amount INTEGER NOT NULL,
  customer_name TEXT,
  report_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_core_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  field TEXT NOT NULL,
  payload TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  diff TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rmt_status ON raw_material_transactions(status);
CREATE INDEX idx_pkg_status ON packaging_reports(status);
CREATE INDEX idx_pcc_status ON product_core_change_requests(status);
CREATE INDEX idx_sales_user_date ON sales_reports(user_id, report_date);
CREATE INDEX idx_pkg_user_date ON packaging_reports(user_id, report_date);