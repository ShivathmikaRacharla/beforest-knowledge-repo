-- PostgreSQL schema-only migration for the Beforest KMS application.
-- This migration creates structure only. It intentionally inserts no application data.

CREATE TABLE IF NOT EXISTS projects (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'Seshu',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'User')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT 'Seshu',
  user_email TEXT,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_feedback (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down', 'neutral')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  feedback_id BIGINT REFERENCES message_feedback(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS query_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_name TEXT,
  query TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  chunks INTEGER NOT NULL DEFAULT 0,
  top_score DOUBLE PRECISION,
  sources JSONB,
  response_id TEXT,
  filter_used JSONB,
  max_num_results INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrieval_traces (
  id BIGSERIAL PRIMARY KEY,
  query_event_id BIGINT NOT NULL REFERENCES query_events(id) ON DELETE CASCADE,
  document_id TEXT,
  file_id TEXT,
  filename TEXT,
  retrieved_text TEXT,
  retrieval_score DOUBLE PRECISION,
  citation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  openai_file_id TEXT,
  vector_store_file_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  department_id TEXT NOT NULL DEFAULT 'general',
  folder_id TEXT NOT NULL DEFAULT 'uploaded-documents',
  document_type TEXT NOT NULL DEFAULT 'document',
  status TEXT NOT NULL DEFAULT 'processing',
  version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  access_group TEXT NOT NULL DEFAULT 'all',
  owner_name TEXT NOT NULL DEFAULT 'Unknown user',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrieval_reviews (
  id BIGSERIAL PRIMARY KEY,
  query_event_id BIGINT NOT NULL UNIQUE REFERENCES query_events(id) ON DELETE CASCADE,
  expected_source TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('relevant', 'miss')),
  notes TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrieval_resolutions (
  id BIGSERIAL PRIMARY KEY,
  query_event_id BIGINT NOT NULL UNIQUE REFERENCES query_events(id) ON DELETE CASCADE,
  resolution TEXT NOT NULL,
  notes TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_configs (
  id BIGSERIAL PRIMARY KEY,
  generation_model TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS document_team_mappings (
  id BIGSERIAL PRIMARY KEY,
  document_key TEXT NOT NULL,
  document_version INTEGER NOT NULL DEFAULT 1,
  team_id BIGINT NOT NULL REFERENCES notification_teams(id) ON DELETE CASCADE,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_key, document_version)
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

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_document_team_mappings_team ON document_team_mappings(team_id);
CREATE INDEX IF NOT EXISTS idx_notification_team_members_team ON notification_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON document_notification_deliveries(status);
