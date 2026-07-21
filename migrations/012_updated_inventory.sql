CREATE TABLE product_stock_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL,
  change_qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_product_stock_tx_status ON product_stock_transactions(status);