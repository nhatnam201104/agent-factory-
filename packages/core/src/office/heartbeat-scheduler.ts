import type { TaskTicket } from "@factory-arena/protocol";
import type { KanbanTaskService } from "../workspace/kanban-task.service.js";
import type { OfficeRosterService } from "./office-roster.service.js";

export interface HeartbeatScheduleRule {
  id: string;
  employeeId: string;
  intervalMs: number;
  onWake?: (employeeId: string, assignedTickets: TaskTicket[]) => Promise<void> | void;
}

export class HeartbeatScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly rules = new Map<string, HeartbeatScheduleRule>();

  constructor(
    private readonly roster: OfficeRosterService,
    private readonly kanban: KanbanTaskService
  ) {}

  public registerSchedule(rule: HeartbeatScheduleRule): void {
    this.unregisterSchedule(rule.id);
    this.rules.set(rule.id, rule);
    const timer = setInterval(() => {
      void this.triggerNow(rule.id);
    }, rule.intervalMs);
    timer.unref();
    this.timers.set(rule.id, timer);
  }

  public async triggerNow(ruleId: string): Promise<TaskTicket[]> {
    const rule = this.rules.get(ruleId);
    if (!rule) return [];
    const emp = this.roster.getEmployeeById(rule.employeeId);
    if (!emp || emp.avatar_pose === "budget_paused") return [];

    const queued = this.kanban
      .listTickets({ assigneeSessionId: emp.id })
      .filter((t) => t.kanban_column === "assigned" || t.kanban_column === "in_progress");

    if (queued.length > 0) {
      this.roster.reportDeskActivity({
        employeeId: emp.id,
        avatarPose: "typing_code",
        lastToolCallSummary: `heartbeat wake: checking ${queued[0].id}`
      });
    }
    if (rule.onWake) {
      await rule.onWake(emp.id, queued);
    }
    return queued;
  }

  public unregisterSchedule(ruleId: string): void {
    const t = this.timers.get(ruleId);
    if (t) clearInterval(t);
    this.timers.delete(ruleId);
    this.rules.delete(ruleId);
  }

  public stopAll(): void {
    for (const id of [...this.timers.keys()]) {
      this.unregisterSchedule(id);
    }
  }
}
