-- Safe additive migration for Windmill/KMS document-ready email notifications.
-- Existing tables are preserved; every statement is idempotent.

CREATE TABLE IF NOT EXISTS notification_teams (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  collection_key TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_team_members (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS document_notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  document_key TEXT NOT NULL,
  document_version INTEGER NOT NULL DEFAULT 1,
  team_id BIGINT NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_key, document_version, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_team_members_team ON notification_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_document_notification_deliveries_status ON document_notification_deliveries(status);
