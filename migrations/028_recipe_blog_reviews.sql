CREATE TABLE IF NOT EXISTS recipe_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  verified_cook INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recipe_slug, user_id)
);
CREATE INDEX IF NOT EXISTS idx_recipe_reviews_slug_status ON recipe_reviews(recipe_slug, status);
CREATE INDEX IF NOT EXISTS idx_recipe_reviews_status ON recipe_reviews(status);

CREATE TABLE IF NOT EXISTS blog_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blog_comments_slug_status ON blog_comments(blog_slug, status);
CREATE INDEX IF NOT EXISTS idx_blog_comments_status ON blog_comments(status);