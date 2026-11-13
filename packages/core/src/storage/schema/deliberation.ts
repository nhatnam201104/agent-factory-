export const DELIBERATION_DDL = `
CREATE TABLE IF NOT EXISTS war_room_meetings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL DEFAULT '',
  linked_ticket_id TEXT,
  repo_root_path TEXT,
  base_branch TEXT,
  protocol_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  participant_ids_json TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  active_guidance_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL,
  consumed_tokens INTEGER NOT NULL DEFAULT 0,
  consumed_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliberation_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  stage TEXT NOT NULL,
  visibility_state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS turn_submissions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  session_employee_id TEXT NOT NULL,
  anonymous_alias TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  artifact_ref TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS critiques (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  reviewer_session_id TEXT NOT NULL,
  target_submission_id TEXT NOT NULL,
  target_anonymous_alias TEXT NOT NULL,
  rubric_scores_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  strengths_summary TEXT NOT NULL DEFAULT '',
  blind_spots_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  voter_session_id TEXT NOT NULL,
  ranked_aliases_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_records (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  winning_submission_id TEXT NOT NULL,
  winning_alias TEXT NOT NULL,
  resolution_method TEXT NOT NULL,
  final_plan_markdown TEXT NOT NULL,
  adopted_amendments_json TEXT NOT NULL DEFAULT '[]',
  dissent_log_json TEXT NOT NULL DEFAULT '[]',
  human_approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
`;
