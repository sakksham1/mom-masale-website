-- Careers is deliberately independent of the storefront catalog. Jobs can be
-- managed through the ERP API without triggering a site build or GitHub sync.

CREATE TABLE IF NOT EXISTS career_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT NOT NULL,
  workplace_type TEXT NOT NULL DEFAULT 'on_site', -- on_site / hybrid / remote
  employment_type TEXT NOT NULL DEFAULT 'full_time', -- full_time / part_time / contract / internship
  experience_level TEXT,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  responsibilities TEXT NOT NULL DEFAULT '[]', -- JSON string array
  qualifications TEXT NOT NULL DEFAULT '[]',   -- JSON string array
  skills TEXT NOT NULL DEFAULT '[]',           -- JSON string array
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT NOT NULL DEFAULT 'INR',
  salary_period TEXT, -- annual / monthly / hourly
  application_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft / published / paused / closed / archived
  published_at TEXT,
  closes_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_career_jobs_public ON career_jobs(status, published_at, closes_at);

CREATE TABLE IF NOT EXISTS career_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES career_jobs(id) ON DELETE RESTRICT,
  applicant_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  location TEXT NOT NULL,
  education TEXT,
  experience TEXT,
  portfolio_url TEXT,
  expected_salary TEXT,
  cover_letter TEXT,
  resume_key TEXT NOT NULL UNIQUE,
  resume_filename TEXT NOT NULL,
  resume_mime TEXT NOT NULL,
  resume_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new / screening / shortlisted / interview / offered / hired / rejected / withdrawn
  source TEXT,
  consent_at TEXT NOT NULL,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_career_applications_job ON career_applications(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_status ON career_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_applications_email_job ON career_applications(email, job_id);

CREATE TABLE IF NOT EXISTS career_application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- applied / status_changed / note_added
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_career_application_events_application ON career_application_events(application_id, created_at);

-- Stores only a salted digest of an applicant IP, never the raw IP. This is
-- used for the public form's lightweight abuse limit and can be pruned safely.
CREATE TABLE IF NOT EXISTS career_application_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_career_application_attempts_ip ON career_application_attempts(ip_hash, created_at);
