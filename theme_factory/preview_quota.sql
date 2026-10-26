CREATE TABLE IF NOT EXISTS theme_ai_daily_quota (
  day TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
);
