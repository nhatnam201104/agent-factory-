import type { DatabaseSync } from "node:sqlite";
import type { EventLedger } from "../storage/event-ledger.js";
import type { OfficeRosterService } from "./office-roster.service.js";

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
    private readonly ledger: EventLedger
  ) {}

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
           WHERE id = ?`
        )
        .run(params.promptTokens + params.completionTokens, params.costUsd, params.roomId);
    }

    if (ratio >= 1.0) {
      this.roster.raiseHandPermission({
        sessionEmployeeId: emp.id,
        ticketId: emp.active_ticket_id ?? null,
        requestKind: "budget_topup",
        promptSummary: `Chạm 100% trần ngân sách phiên ($${newSessionCost.toFixed(2)} / $${cap.toFixed(2)}). Xin cấp thêm hạn mức.`,
        riskLevel: "high"
      });

      this.db
        .prepare(
          `UPDATE session_employees
           SET session_cost_usd = ?, avatar_pose = 'budget_paused', connection_status = 'waiting_permission'
           WHERE id = ?`
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
          estimated_cost_usd: params.costUsd
        },
        payload: {
          session_cost_usd: newSessionCost,
          max_session_budget_usd: cap,
          utilization_ratio: ratio
        }
      });

      return {
        status: "hard_stopped_100pct",
        sessionCostUsd: newSessionCost,
        maxSessionBudgetUsd: cap,
        utilizationRatio: ratio
      };
    }

    this.db
      .prepare(`UPDATE session_employees SET session_cost_usd = ? WHERE id = ?`)
      .run(newSessionCost, emp.id);

    return {
      status: ratio >= 0.8 ? "warning_80pct" : "ok",
      sessionCostUsd: newSessionCost,
      maxSessionBudgetUsd: cap,
      utilizationRatio: ratio
    };
  }
}
