CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  date_window_days INTEGER NOT NULL DEFAULT 3 CHECK (date_window_days >= 0 AND date_window_days <= 31),
  amount_tolerance_minor TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'reviewer', 'read_only')),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'committed', 'committed_with_errors')),
  mapping_json TEXT,
  amount_locale TEXT,
  date_format TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE import_files (
  import_id TEXT PRIMARY KEY REFERENCES imports(id),
  csv_text TEXT NOT NULL
);

CREATE TABLE source_rows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  import_id TEXT NOT NULL REFERENCES imports(id),
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  supplier_id_raw TEXT NOT NULL DEFAULT '',
  supplier_name_raw TEXT NOT NULL DEFAULT '',
  invoice_number_raw TEXT NOT NULL DEFAULT '',
  invoice_date_raw TEXT NOT NULL DEFAULT '',
  amount_raw TEXT NOT NULL DEFAULT '',
  currency_raw TEXT NOT NULL DEFAULT '',
  payment_status_raw TEXT NOT NULL DEFAULT '',
  document_kind_raw TEXT NOT NULL DEFAULT '',
  supplier_key TEXT,
  invoice_key TEXT,
  invoice_date TEXT,
  amount_minor TEXT,
  currency TEXT,
  payment_status TEXT NOT NULL DEFAULT '',
  document_kind TEXT NOT NULL DEFAULT '',
  error_codes TEXT NOT NULL DEFAULT '[]',
  exclusion_codes TEXT NOT NULL DEFAULT '[]',
  matchable INTEGER NOT NULL DEFAULT 0 CHECK (matchable IN (0, 1)),
  UNIQUE (import_id, row_number)
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'proximity')),
  group_key TEXT NOT NULL,
  supplier_key TEXT NOT NULL,
  invoice_key TEXT,
  currency TEXT NOT NULL,
  exposure_minor TEXT NOT NULL,
  recovered_minor TEXT NOT NULL DEFAULT '0',
  confidence TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'confirmed_for_review', 'false_positive', 'dissolved')),
  display_supplier TEXT NOT NULL DEFAULT '',
  display_invoice TEXT NOT NULL DEFAULT '',
  member_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, group_key)
);

CREATE TABLE case_rows (
  case_id TEXT NOT NULL REFERENCES cases(id),
  source_row_id TEXT NOT NULL REFERENCES source_rows(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL CHECK (role IN ('primary', 'extra')),
  PRIMARY KEY (case_id, source_row_id)
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,
  comment TEXT NOT NULL,
  recovered_minor TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_imports_workspace ON imports(workspace_id, created_at);
CREATE INDEX idx_source_rows_workspace ON source_rows(workspace_id);
CREATE INDEX idx_source_rows_import ON source_rows(import_id);
CREATE INDEX idx_cases_workspace ON cases(workspace_id, status);
CREATE INDEX idx_case_rows_row ON case_rows(source_row_id);
CREATE INDEX idx_decisions_case ON decisions(case_id, created_at);
CREATE INDEX idx_audit_workspace ON audit_events(workspace_id, created_at);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;
