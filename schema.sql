-- Automation Factory · Money Scout v0.19.0
-- v0.1의 jobs 테이블은 삭제하지 않습니다. v0.2는 새 opportunities 테이블을 사용합니다.

CREATE TABLE IF NOT EXISTS opportunities (
  opportunity_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  budget_min REAL,
  budget_max REAL,
  currency TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  competition INTEGER,
  url TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'cold',
  score_breakdown TEXT NOT NULL DEFAULT '{}',
  judge_reason TEXT NOT NULL DEFAULT '',
  user_state TEXT NOT NULL DEFAULT 'unreviewed',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_grade_score ON opportunities(grade, score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_state_score ON opportunities(user_state, score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_source_seen ON opportunities(source, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS scout_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  source_count INTEGER NOT NULL DEFAULT 0,
  found_count INTEGER NOT NULL DEFAULT 0,
  saved_count INTEGER NOT NULL DEFAULT 0,
  hot_count INTEGER NOT NULL DEFAULT 0,
  watch_count INTEGER NOT NULL DEFAULT 0,
  cold_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_scout_runs_started ON scout_runs(started_at DESC);

-- v0.3 이후 Profit / Failure Memory에서 사용
CREATE TABLE IF NOT EXISTS opportunity_outcomes (
  opportunity_id TEXT PRIMARY KEY,
  result TEXT NOT NULL DEFAULT '',
  actual_revenue REAL,
  actual_cost REAL,
  actual_minutes INTEGER,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);


-- v0.17.0 Production Pipeline
CREATE TABLE IF NOT EXISTS production_runs (
  run_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  bundle_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'created',
  conclusion TEXT NOT NULL DEFAULT '',
  log_summary TEXT NOT NULL DEFAULT '',
  github_run_id TEXT NOT NULL DEFAULT '',
  package_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_production_runs_opportunity
ON production_runs(opportunity_id, created_at DESC);


-- v0.18.0 Client Intake
CREATE TABLE IF NOT EXISTS client_intakes (
  opportunity_id TEXT PRIMARY KEY,
  public_answers_json TEXT NOT NULL DEFAULT '{}',
  secret_answers_enc TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_intakes_status
ON client_intakes(status, updated_at DESC);


-- v0.18.3 Account Connection Gate
CREATE TABLE IF NOT EXISTS account_connections (
  opportunity_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  auth_method TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  secret_enc TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(opportunity_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_account_connections_status
ON account_connections(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  verifier_enc TEXT NOT NULL DEFAULT '',
  redirect_uri TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry
ON oauth_states(expires_at);


-- v0.19.0 Contract & Payment Gate
CREATE TABLE IF NOT EXISTS contract_payment_gates (
  opportunity_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT '',
  application_status TEXT NOT NULL DEFAULT 'not_applied',
  contract_status TEXT NOT NULL DEFAULT 'not_agreed',
  payment_status TEXT NOT NULL DEFAULT 'unsecured',
  payment_protection TEXT NOT NULL DEFAULT 'unknown',
  gross_amount REAL,
  currency TEXT NOT NULL DEFAULT '',
  fee_estimate REAL,
  net_estimate REAL,
  payout_route TEXT NOT NULL DEFAULT '',
  payout_destination TEXT NOT NULL DEFAULT '',
  external_reference TEXT NOT NULL DEFAULT '',
  evidence_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_payment_status
ON contract_payment_gates(contract_status, payment_status, updated_at DESC);
