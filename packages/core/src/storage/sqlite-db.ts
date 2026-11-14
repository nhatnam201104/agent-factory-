import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DELIBERATION_DDL } from "./schema/deliberation.js";
import { EMPLOYEES_DDL } from "./schema/employees.js";
import { TICKETS_DDL } from "./schema/tickets.js";

const VAULT_DDL = `
CREATE TABLE IF NOT EXISTS credential_profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  base_url TEXT,
  encrypted_secret BLOB NOT NULL,
  rate_limit_rpm INTEGER,
  max_cost_usd REAL,
  created_at TEXT NOT NULL
);
`;

export interface ArenaStoragePaths {
  stateDir: string;
  dbPath: string;
  eventsDir: string;
  artifactsDir: string;
  worktreesDir: string;
}

export function resolveStoragePaths(baseDir: string): ArenaStoragePaths {
  const stateDir = baseDir;
  const dbPath = join(stateDir, "arena.db");
  const eventsDir = join(stateDir, "events");
  const artifactsDir = join(stateDir, "artifacts");
  const worktreesDir = join(stateDir, "worktrees");
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(worktreesDir, { recursive: true });
  return { stateDir, dbPath, eventsDir, artifactsDir, worktreesDir };
}

export function openArenaDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(VAULT_DDL);
  db.exec(EMPLOYEES_DDL);
  const empCols = db.prepare("PRAGMA table_info(session_employees)").all() as Array<{
    name?: string;
  }>;
  if (!empCols.some((c) => c.name === "cli_command_json")) {
    db.exec("ALTER TABLE session_employees ADD COLUMN cli_command_json TEXT;");
  }
  db.exec(TICKETS_DDL);
  db.exec(DELIBERATION_DDL);
  return db;
}
