CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget_min REAL,
  budget_max REAL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  duration TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  applicant_count INTEGER,
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  classify_reason TEXT NOT NULL DEFAULT '',
  found_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_job_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_found ON jobs(status, found_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source_posted ON jobs(source, posted_at DESC);
