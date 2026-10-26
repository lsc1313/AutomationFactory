-- Theme Factory v0.1 isolated tables; not applied automatically.
CREATE TABLE IF NOT EXISTS theme_jobs (
  id TEXT PRIMARY KEY,
  concept TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  artifact_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_theme_jobs_status_created ON theme_jobs(status, created_at);
CREATE TABLE IF NOT EXISTS theme_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES theme_jobs(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
