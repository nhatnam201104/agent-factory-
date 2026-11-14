export const EMPLOYEES_DDL = `
CREATE TABLE IF NOT EXISTS role_templates (
  id TEXT PRIMARY KEY,
  department TEXT NOT NULL,
  job_title TEXT NOT NULL,
  reports_to_role_id TEXT,
  avatar_preset TEXT NOT NULL DEFAULT 'teal-engineer',
  default_capabilities_json TEXT NOT NULL,
  monthly_budget_usd REAL NOT NULL DEFAULT 25.0
);

CREATE TABLE IF NOT EXISTS session_employees (
  id TEXT PRIMARY KEY,
  session_fingerprint TEXT NOT NULL UNIQUE,
  role_template_id TEXT NOT NULL,
  employee_code TEXT NOT NULL,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  department TEXT NOT NULL,
  job_title TEXT NOT NULL,
  transport_type TEXT NOT NULL,
  system_instructions TEXT,
  model_identifier TEXT,
  credential_id TEXT,
  capabilities_json TEXT NOT NULL,
  agent_card_json TEXT,
  cli_command_json TEXT,
  desk_slot_id TEXT NOT NULL,
  spatial_zone TEXT NOT NULL DEFAULT 'at_desk',
  avatar_pose TEXT NOT NULL DEFAULT 'idle',
  connection_status TEXT NOT NULL DEFAULT 'online',
  active_ticket_id TEXT,
  context_fill_pct REAL NOT NULL DEFAULT 0,
  session_cost_usd REAL NOT NULL DEFAULT 0,
  max_session_budget_usd REAL NOT NULL DEFAULT 5.0,
  last_tool_call_summary TEXT,
  last_heartbeat_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_requests (
  id TEXT PRIMARY KEY,
  session_employee_id TEXT NOT NULL,
  ticket_id TEXT,
  request_kind TEXT NOT NULL,
  prompt_summary TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  answer_text TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
`;
