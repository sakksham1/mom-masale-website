CREATE TABLE IF NOT EXISTS content_staging (
  source_type TEXT PRIMARY KEY,      -- 'recipes' | 'blog' | 'settings'
  content     TEXT NOT NULL,          -- full pending file content
  updated_by  INTEGER,
  updated_at  TEXT DEFAULT (datetime('now'))
);