-- Universal Intake v1 additive schema. Existing Money Scout tables are intentionally untouched.
CREATE TABLE IF NOT EXISTS intake_jobs (
  intake_job_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  file_count INTEGER NOT NULL DEFAULT 0,
  ready_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intake_files (
  intake_file_id TEXT PRIMARY KEY,
  intake_job_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  file_kind TEXT NOT NULL DEFAULT 'unknown',
  document_type TEXT NOT NULL DEFAULT 'unknown',
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intake_files_job ON intake_files(intake_job_id, created_at);
CREATE TABLE IF NOT EXISTS mapping_profiles (
  mapping_profile_id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL DEFAULT 'unknown',
  source_signature TEXT NOT NULL DEFAULT '',
  mapping_json TEXT NOT NULL DEFAULT '{}',
  confirmed INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intake_review_queue (
  review_id TEXT PRIMARY KEY,
  intake_job_id TEXT NOT NULL,
  intake_file_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intake_review_status ON intake_review_queue(status, created_at);
