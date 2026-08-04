CREATE TABLE IF NOT EXISTS site_sync_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by INTEGER REFERENCES users(id),
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS site_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  product_slug TEXT,
  summary TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending',
  synced_batch_id INTEGER REFERENCES site_sync_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_site_sync_queue_status ON site_sync_queue(status);

CREATE TABLE IF NOT EXISTS site_sync_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  syncing INTEGER NOT NULL DEFAULT 0,
  locked_by INTEGER REFERENCES users(id),
  locked_at TEXT
);
INSERT OR IGNORE INTO site_sync_lock (id, syncing) VALUES (1, 0);