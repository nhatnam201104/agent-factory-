export const TICKETS_DDL = `
CREATE TABLE IF NOT EXISTS task_tickets (
  id TEXT PRIMARY KEY,
  parent_ticket_id TEXT,
  decision_id TEXT,
  title TEXT NOT NULL,
  description_markdown TEXT NOT NULL DEFAULT '',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  depends_on_tickets_json TEXT NOT NULL DEFAULT '[]',
  kanban_column TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'p2_normal',
  assignee_session_id TEXT,
  reviewer_session_ids_json TEXT NOT NULL DEFAULT '[]',
  repo_root_path TEXT,
  base_branch TEXT NOT NULL DEFAULT 'main',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  failure_notes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_leases (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  session_employee_id TEXT NOT NULL,
  repo_root_path TEXT NOT NULL,
  isolation_mode TEXT NOT NULL,
  worktree_path TEXT,
  branch_name TEXT,
  locked_globs_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  released_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_leases_active
  ON workspace_leases (repo_root_path, released_at, expires_at);

CREATE TABLE IF NOT EXISTS blackboard_artifacts (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  ticket_id TEXT,
  author_session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'text/markdown',
  storage_path TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  compact_digest TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`;
