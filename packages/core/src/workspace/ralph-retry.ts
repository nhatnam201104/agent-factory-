import type { DatabaseSync } from "node:sqlite";
import type { TaskTicket } from "@factory-arena/protocol";
import type { LogCrusher } from "../blackboard/log-crusher.js";
import type { EventLedger } from "../storage/event-ledger.js";
import type { GitWorktreeManager } from "./git-worktree-manager.js";

export interface RalphRetryOutcome {
  action: "clean_retried" | "escalated_to_director";
  retryCount: number;
  compactFailureNote: string;
}

export class RalphRetrySupervisor {
  constructor(
    private readonly db: DatabaseSync,
    private readonly worktrees: GitWorktreeManager,
    private readonly crusher: LogCrusher,
    private readonly ledger: EventLedger
  ) {}

  public handleFailure(params: {
    roomId: string;
    ticket: TaskTicket;
    worktreePath?: string | null;
    rawFailureLog: string;
  }): RalphRetryOutcome {
    const crushed = this.crusher.crush(params.rawFailureLog, 20).compressed.slice(0, 1800);
    const nextRetry = params.ticket.retry_count + 1;
    const notes = [...params.ticket.failure_notes, crushed];

    if (params.worktreePath) {
      this.worktrees.resetWorktreeClean(params.worktreePath, "HEAD");
    }

    if (nextRetry > params.ticket.max_retries) {
      this.db
        .prepare(
          `UPDATE task_tickets
           SET retry_count = ?, failure_notes_json = ?, kanban_column = 'blocked', updated_at = ?
           WHERE id = ?`
        )
        .run(nextRetry, JSON.stringify(notes), new Date().toISOString(), params.ticket.id);

      this.ledger.append({
        roomId: params.roomId,
        eventType: "bead.ralph_retry_triggered",
        actorSessionEmployeeId: params.ticket.assignee_session_id ?? undefined,
        payload: {
          ticket_id: params.ticket.id,
          retry_count: nextRetry,
          escalated: true,
          compact_failure_note: crushed
        }
      });

      return {
        action: "escalated_to_director",
        retryCount: nextRetry,
        compactFailureNote: crushed
      };
    }

    this.db
      .prepare(
        `UPDATE task_tickets
         SET retry_count = ?, failure_notes_json = ?, kanban_column = 'in_progress', updated_at = ?
         WHERE id = ?`
      )
      .run(nextRetry, JSON.stringify(notes), new Date().toISOString(), params.ticket.id);

    this.ledger.append({
      roomId: params.roomId,
      eventType: "bead.ralph_retry_triggered",
      actorSessionEmployeeId: params.ticket.assignee_session_id ?? undefined,
      payload: {
        ticket_id: params.ticket.id,
        retry_count: nextRetry,
        escalated: false,
        compact_failure_note: crushed
      }
    });

    return {
      action: "clean_retried",
      retryCount: nextRetry,
      compactFailureNote: crushed
    };
  }
}
