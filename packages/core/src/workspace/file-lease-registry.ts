import type { DatabaseSync } from "node:sqlite";
import {
  type IsolationMode,
  type WorkspaceLease,
  WorkspaceLeaseSchema,
  isoNow,
  prefixedUlid
} from "@factory-arena/protocol";
import type { EventLedger } from "../storage/event-ledger.js";
import type { GitWorktreeManager } from "./git-worktree-manager.js";

export class LeaseConflictError extends Error {
  constructor(
    message: string,
    public readonly conflictingLease: WorkspaceLease
  ) {
    super(message);
    this.name = "LeaseConflictError";
  }
}

function normalizePrefix(globPattern: string): string {
  return globPattern.replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "").replace(/\/+$/, "");
}

export function globsOverlap(a: string, b: string): boolean {
  if (a === b || a === "**" || b === "**" || a === "*" || b === "*") return true;
  const pa = normalizePrefix(a);
  const pb = normalizePrefix(b);
  if (!pa || !pb) return true;
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

export class FileLeaseRegistry {
  constructor(
    private readonly db: DatabaseSync,
    private readonly worktrees: GitWorktreeManager,
    private readonly ledger: EventLedger
  ) {}

  public acquireLease(params: {
    roomId: string;
    ticketId: string;
    sessionEmployeeId: string;
    employeeCode: string;
    repoRootPath: string;
    baseBranch?: string;
    isolationMode: IsolationMode;
    lockedGlobs?: string[];
    ttlSeconds?: number;
  }): WorkspaceLease {
    const now = isoNow();
    const ttlMs = (params.ttlSeconds ?? 600) * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const globs = params.lockedGlobs ?? [];

    if (params.isolationMode === "file_lock") {
      const activeRows = this.db
        .prepare(
          `SELECT * FROM workspace_leases
           WHERE repo_root_path = ?
             AND isolation_mode = 'file_lock'
             AND released_at IS NULL
             AND expires_at > ?`
        )
        .all(params.repoRootPath, now) as Array<Record<string, unknown>>;

      for (const row of activeRows) {
        const existing = this.mapRow(row);
        if (existing.session_employee_id === params.sessionEmployeeId) continue;
        const hasOverlap =
          globs.length === 0 ||
          existing.locked_globs.length === 0 ||
          globs.some((g1) => existing.locked_globs.some((g2) => globsOverlap(g1, g2)));

        if (hasOverlap) {
          this.ledger.append({
            roomId: params.roomId,
            eventType: "workspace_lease.conflict_detected",
            actorSessionEmployeeId: params.sessionEmployeeId,
            payload: {
              requested_ticket_id: params.ticketId,
              requested_globs: globs,
              holder_session_employee_id: existing.session_employee_id,
              conflicting_lease_id: existing.id
            }
          });
          throw new LeaseConflictError(
            `File lock conflict on ${params.repoRootPath} with active lease ${existing.id}`,
            existing
          );
        }
      }
    }

    let worktreePath: string | null = null;
    let branchName: string | null = null;
    if (params.isolationMode === "git_worktree") {
      const wt = this.worktrees.provisionWorktree({
        repoRootPath: params.repoRootPath,
        baseBranch: params.baseBranch,
        roomId: params.roomId,
        ticketId: params.ticketId,
        employeeCode: params.employeeCode
      });
      worktreePath = wt.worktreePath;
      branchName = wt.branchName;
    }

    const lease = WorkspaceLeaseSchema.parse({
      id: prefixedUlid("lease"),
      room_id: params.roomId,
      ticket_id: params.ticketId,
      session_employee_id: params.sessionEmployeeId,
      repo_root_path: params.repoRootPath,
      isolation_mode: params.isolationMode,
      worktree_path: worktreePath,
      branch_name: branchName,
      locked_globs: globs,
      expires_at: expiresAt,
      released_at: null
    });

    this.db
      .prepare(
        `INSERT INTO workspace_leases
          (id, room_id, ticket_id, session_employee_id, repo_root_path, isolation_mode, worktree_path, branch_name, locked_globs_json, expires_at, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        lease.id,
        lease.room_id,
        lease.ticket_id,
        lease.session_employee_id,
        lease.repo_root_path,
        lease.isolation_mode,
        lease.worktree_path ?? null,
        lease.branch_name ?? null,
        JSON.stringify(lease.locked_globs),
        lease.expires_at
      );

    this.ledger.append({
      roomId: params.roomId,
      eventType: "workspace_lease.acquired",
      actorSessionEmployeeId: params.sessionEmployeeId,
      payload: { lease }
    });

    return lease;
  }

  public releaseLease(leaseId: string): void {
    this.db
      .prepare(`UPDATE workspace_leases SET released_at = ? WHERE id = ?`)
      .run(isoNow(), leaseId);
  }

  public listActiveLeases(repoRootPath?: string): WorkspaceLease[] {
    const now = isoNow();
    const rows = repoRootPath
      ? (this.db
          .prepare(
            `SELECT * FROM workspace_leases WHERE repo_root_path = ? AND released_at IS NULL AND expires_at > ?`
          )
          .all(repoRootPath, now) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(`SELECT * FROM workspace_leases WHERE released_at IS NULL AND expires_at > ?`)
          .all(now) as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): WorkspaceLease {
    return WorkspaceLeaseSchema.parse({
      id: String(row.id),
      room_id: String(row.room_id),
      ticket_id: String(row.ticket_id),
      session_employee_id: String(row.session_employee_id),
      repo_root_path: String(row.repo_root_path),
      isolation_mode: row.isolation_mode,
      worktree_path: row.worktree_path ? String(row.worktree_path) : null,
      branch_name: row.branch_name ? String(row.branch_name) : null,
      locked_globs: JSON.parse(String(row.locked_globs_json)),
      expires_at: String(row.expires_at),
      released_at: row.released_at ? String(row.released_at) : null
    });
  }
}
