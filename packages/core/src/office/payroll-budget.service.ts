import type { DatabaseSync } from "node:sqlite";
import { parseStoredRoomConfig } from "../engine/room-config.js";
import type { EventLedger } from "../storage/event-ledger.js";
import type { OfficeRosterService } from "./office-roster.service.js";

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly details: {
      scope: "employee" | "credential" | "room";
      sessionEmployeeId?: string;
      roomId?: string;
      consumedUsd?: number;
      capUsd?: number;
      consumedTokens?: number;
      capTokens?: number;
    },
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetCheckOutcome {
  status: "ok" | "warning_80pct" | "hard_stopped_100pct";
  sessionCostUsd: number;
  maxSessionBudgetUsd: number;
  utilizationRatio: number;
}

export class PayrollBudgetGuard {
  constructor(
    private readonly db: DatabaseSync,
    private readonly roster: OfficeRosterService,
    private readonly ledger: EventLedger,
  ) {}

  public assertWithinBudget(params: {
    sessionEmployeeId?: string;
    roomId?: string;
    /** Credential whose shared cap applies; defaults to the employee's own credential. */
    credentialId?: string;
    credentialMaxCostUsd?: number;
  }): void {
    if (params.sessionEmployeeId) {
      const emp = this.roster.getEmployeeById(params.sessionEmployeeId);
      if (!emp) {
        throw new Error(`SessionEmployee not found: ${params.sessionEmployeeId}`);
      }

      // The credential cap is shared by every employee on that key, so it is compared with the
      // credential's total spend. A per-employee top-up cannot lift it, so the employee is not
      // parked in budget_paused for it; the director raises max_cost_usd in the vault instead.
      const credentialId = params.credentialId ?? emp.credential_id;
      const credentialCap = params.credentialMaxCostUsd;
      if (credentialId && credentialCap !== undefined && credentialCap >= 0) {
        const credentialSpent = this.credentialSpendUsd(credentialId);
        if (credentialSpent >= credentialCap) {
          throw new BudgetExceededError(
            `Credential ${credentialId} reached its cost cap ($${credentialSpent.toFixed(2)} / $${credentialCap.toFixed(2)}); raise max_cost_usd in the vault to continue`,
            {
              scope: "credential",
              sessionEmployeeId: emp.id,
              roomId: params.roomId,
              consumedUsd: credentialSpent,
              capUsd: credentialCap,
            },
          );
        }
      }

      const effectiveCap = emp.max_session_budget_usd > 0 ? emp.max_session_budget_usd : 5;
      if (emp.avatar_pose === "budget_paused" || emp.session_cost_usd >= effectiveCap) {
        if (emp.avatar_pose !== "budget_paused") {
          this.db
            .prepare(
              `UPDATE session_employees
               SET avatar_pose = 'budget_paused', connection_status = 'waiting_permission'
               WHERE id = ?`,
            )
            .run(emp.id);
        }
        // Always leave the director a way out: a pending top-up request they can approve.
        this.ensureTopupRequested(
          emp.id,
          emp.active_ticket_id ?? null,
          emp.session_cost_usd,
          effectiveCap,
        );
        throw new BudgetExceededError(
          `Employee ${emp.employee_code} is budget_paused ($${emp.session_cost_usd.toFixed(2)} / $${effectiveCap.toFixed(2)})`,
          {
            scope: "employee",
            sessionEmployeeId: emp.id,
            roomId: params.roomId,
            consumedUsd: emp.session_cost_usd,
            capUsd: effectiveCap,
          },
        );
      }
    }

    if (params.roomId && params.roomId !== "office-global") {
      const roomRow = this.db
        .prepare(
          "SELECT config_json, consumed_tokens, consumed_cost_usd FROM war_room_meetings WHERE id = ?",
        )
        .get(params.roomId) as Record<string, unknown> | undefined;
      if (roomRow) {
        const config = parseStoredRoomConfig(String(roomRow.config_json));
        const consumedTokens = Number(roomRow.consumed_tokens);
        const consumedCostUsd = Number(roomRow.consumed_cost_usd);
        if (consumedTokens >= config.budget_tokens || consumedCostUsd >= config.max_cost_usd) {
          throw new BudgetExceededError(
            `Room ${params.roomId} exceeded budget (${consumedTokens}/${config.budget_tokens} tokens, $${consumedCostUsd.toFixed(2)}/$${config.max_cost_usd.toFixed(2)})`,
            {
              scope: "room",
              roomId: params.roomId,
              consumedUsd: consumedCostUsd,
              capUsd: config.max_cost_usd,
              consumedTokens,
              capTokens: config.budget_tokens,
            },
          );
        }
      }
    }
  }

  /** Total session spend of every employee using the credential. */
  private credentialSpendUsd(credentialId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(session_cost_usd), 0) AS spent FROM session_employees WHERE credential_id = ?",
      )
      .get(credentialId) as { spent: number } | undefined;
    return Number(row?.spent ?? 0);
  }

  /** Raise a budget_topup request unless one is already pending (approving twice would stack). */
  private ensureTopupRequested(
    sessionEmployeeId: string,
    ticketId: string | null,
    spentUsd: number,
    capUsd: number,
  ): void {
    if (this.roster.findPendingPermission(sessionEmployeeId, "budget_topup")) return;
    this.roster.raiseHandPermission({
      sessionEmployeeId,
      ticketId,
      requestKind: "budget_topup",
      promptSummary: `Chạm 100% trần ngân sách phiên ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}). Xin cấp thêm hạn mức.`,
      riskLevel: "high",
    });
  }

  public recordSpend(params: {
    sessionEmployeeId: string;
    roomId?: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  }): BudgetCheckOutcome {
    const emp = this.roster.getEmployeeById(params.sessionEmployeeId);
    if (!emp) {
      throw new Error(`SessionEmployee not found: ${params.sessionEmployeeId}`);
    }

    const newSessionCost = Number((emp.session_cost_usd + params.costUsd).toFixed(6));
    const cap = emp.max_session_budget_usd > 0 ? emp.max_session_budget_usd : 5;
    const ratio = newSessionCost / cap;

    if (params.roomId) {
      this.db
        .prepare(
          `UPDATE war_room_meetings
           SET consumed_tokens = consumed_tokens + ?,
               consumed_cost_usd = consumed_cost_usd + ?
           WHERE id = ?`,
        )
        .run(params.promptTokens + params.completionTokens, params.costUsd, params.roomId);
    }

    if (ratio >= 1.0) {
      this.ensureTopupRequested(emp.id, emp.active_ticket_id ?? null, newSessionCost, cap);

      this.db
        .prepare(
          `UPDATE session_employees
           SET session_cost_usd = ?, avatar_pose = 'budget_paused', connection_status = 'waiting_permission'
           WHERE id = ?`,
        )
        .run(newSessionCost, emp.id);

      this.ledger.append({
        roomId: params.roomId ?? "office-global",
        eventType: "employee.budget_paused",
        actorSessionEmployeeId: emp.id,
        tokenAccounting: {
          prompt_tokens: params.promptTokens,
          completion_tokens: params.completionTokens,
          saved_by_context_slicer_tokens: 0,
          estimated_cost_usd: params.costUsd,
        },
        payload: {
          session_cost_usd: newSessionCost,
          max_session_budget_usd: cap,
          utilization_ratio: ratio,
        },
      });

      return {
        status: "hard_stopped_100pct",
        sessionCostUsd: newSessionCost,
        maxSessionBudgetUsd: cap,
        utilizationRatio: ratio,
      };
    }

    this.db
      .prepare("UPDATE session_employees SET session_cost_usd = ? WHERE id = ?")
      .run(newSessionCost, emp.id);

    return {
      status: ratio >= 0.8 ? "warning_80pct" : "ok",
      sessionCostUsd: newSessionCost,
      maxSessionBudgetUsd: cap,
      utilizationRatio: ratio,
    };
  }
}
