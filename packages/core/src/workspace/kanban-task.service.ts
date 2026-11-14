import type { DatabaseSync } from "node:sqlite";
import {
  type CreateTicketInput,
  CreateTicketInputSchema,
  type KanbanColumn,
  type TaskTicket,
  TaskTicketSchema,
  isoNow,
} from "@factory-arena/protocol";
import type { OfficeRosterService } from "../office/office-roster.service.js";
import type { EventLedger } from "../storage/event-ledger.js";

export class KanbanTaskService {
  private seq = 100;

  constructor(
    private readonly db: DatabaseSync,
    private readonly roster: OfficeRosterService,
    private readonly ledger: EventLedger,
  ) {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM task_tickets").get() as {
      cnt: number;
    };
    this.seq = 100 + Number(row?.cnt ?? 0);
  }

  public createTicket(rawInput: CreateTicketInput): TaskTicket {
    const input = CreateTicketInputSchema.parse(rawInput);
    this.seq += 1;
    const id = input.id ?? `TSK-${this.seq}`;
    const now = isoNow();
    const col: KanbanColumn =
      input.assignee_session_id && input.kanban_column === "backlog"
        ? "assigned"
        : input.kanban_column;

    const ticket = TaskTicketSchema.parse({
      id,
      parent_ticket_id: input.parent_ticket_id ?? null,
      decision_id: input.decision_id ?? null,
      title: input.title,
      description_markdown: input.description_markdown,
      acceptance_criteria: input.acceptance_criteria,
      depends_on_tickets: input.depends_on_tickets,
      kanban_column: col,
      priority: input.priority,
      assignee_session_id: input.assignee_session_id ?? null,
      reviewer_session_ids: input.reviewer_session_ids,
      repo_root_path: input.repo_root_path,
      base_branch: input.base_branch,
      retry_count: 0,
      max_retries: 2,
      failure_notes: [],
      created_at: now,
      updated_at: now,
    });

    this.db
      .prepare(
        `INSERT INTO task_tickets
          (id, parent_ticket_id, decision_id, title, description_markdown, acceptance_criteria_json,
           depends_on_tickets_json, kanban_column, priority, assignee_session_id, reviewer_session_ids_json,
           repo_root_path, base_branch, retry_count, max_retries, failure_notes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ticket.id,
        ticket.parent_ticket_id ?? null,
        ticket.decision_id ?? null,
        ticket.title,
        ticket.description_markdown,
        JSON.stringify(ticket.acceptance_criteria),
        JSON.stringify(ticket.depends_on_tickets),
        ticket.kanban_column,
        ticket.priority,
        ticket.assignee_session_id ?? null,
        JSON.stringify(ticket.reviewer_session_ids),
        ticket.repo_root_path ?? null,
        ticket.base_branch,
        ticket.retry_count,
        ticket.max_retries,
        JSON.stringify(ticket.failure_notes),
        ticket.created_at,
        ticket.updated_at,
      );

    if (ticket.assignee_session_id) {
      this.roster.setActiveTicket(ticket.assignee_session_id, ticket.id);
    }

    this.ledger.append({
      roomId: "office-global",
      eventType: "ticket.created",
      actorSessionEmployeeId: ticket.assignee_session_id ?? undefined,
      payload: { ticket },
    });

    return ticket;
  }

  public updateTicket(
    ticketId: string,
    patch: {
      kanban_column?: KanbanColumn;
      assignee_session_id?: string | null;
      reviewer_session_ids?: string[];
    },
  ): TaskTicket {
    const existing = this.getTicketById(ticketId);
    if (!existing) {
      throw new Error(`TaskTicket not found: ${ticketId}`);
    }

    const nextAssignee =
      patch.assignee_session_id !== undefined
        ? patch.assignee_session_id
        : existing.assignee_session_id;
    const nextCol = patch.kanban_column ?? existing.kanban_column;
    const nextReviewers = patch.reviewer_session_ids ?? existing.reviewer_session_ids;
    const now = isoNow();

    this.db
      .prepare(
        `UPDATE task_tickets
         SET kanban_column = ?, assignee_session_id = ?, reviewer_session_ids_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextCol, nextAssignee ?? null, JSON.stringify(nextReviewers), now, ticketId);

    if (nextAssignee) {
      this.roster.setActiveTicket(nextAssignee, nextCol === "done" ? null : ticketId);
      this.ledger.append({
        roomId: "office-global",
        eventType: "ticket.assigned",
        actorSessionEmployeeId: nextAssignee,
        payload: { ticket_id: ticketId, assignee_session_id: nextAssignee, kanban_column: nextCol },
      });
    } else {
      this.ledger.append({
        roomId: "office-global",
        eventType: "ticket.status_changed",
        payload: { ticket_id: ticketId, kanban_column: nextCol },
      });
    }

    const updated = this.getTicketById(ticketId);
    if (!updated) {
      throw new Error(`TaskTicket disappeared after update: ${ticketId}`);
    }
    return updated;
  }

  public decomposeEpic(params: {
    parentTicketId: string;
    decisionId?: string;
    subtasks: Array<{
      title: string;
      assigneeSessionId?: string;
      acceptanceCriteria?: string[];
      dependsOnIndex?: number[];
    }>;
  }): TaskTicket[] {
    const parent = this.getTicketById(params.parentTicketId);
    if (!parent) {
      throw new Error(`Parent TaskTicket not found: ${params.parentTicketId}`);
    }

    const created: TaskTicket[] = [];
    for (const item of params.subtasks) {
      const deps = (item.dependsOnIndex ?? [])
        .map((idx) => created[idx]?.id)
        .filter((v): v is string => Boolean(v));
      const child = this.createTicket({
        parent_ticket_id: parent.id,
        decision_id: params.decisionId ?? null,
        title: item.title,
        acceptance_criteria: item.acceptanceCriteria ?? [],
        depends_on_tickets: deps,
        assignee_session_id: item.assigneeSessionId ?? null,
        kanban_column: item.assigneeSessionId ? "assigned" : "backlog",
        priority: parent.priority,
        repo_root_path: parent.repo_root_path,
        base_branch: parent.base_branch,
      });
      created.push(child);
    }
    return created;
  }

  public getTicketById(id: string): TaskTicket | null {
    const row = this.db.prepare("SELECT * FROM task_tickets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listTickets(
    filter: { assigneeSessionId?: string; kanbanColumn?: KanbanColumn } = {},
  ): TaskTicket[] {
    let sql = "SELECT * FROM task_tickets WHERE 1=1";
    const args: string[] = [];
    if (filter.assigneeSessionId) {
      sql += " AND assignee_session_id = ?";
      args.push(filter.assigneeSessionId);
    }
    if (filter.kanbanColumn) {
      sql += " AND kanban_column = ?";
      args.push(filter.kanbanColumn);
    }
    sql += " ORDER BY created_at ASC";
    const rows = this.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): TaskTicket {
    return TaskTicketSchema.parse({
      id: String(row.id),
      parent_ticket_id: row.parent_ticket_id ? String(row.parent_ticket_id) : null,
      decision_id: row.decision_id ? String(row.decision_id) : null,
      title: String(row.title),
      description_markdown: String(row.description_markdown),
      acceptance_criteria: JSON.parse(String(row.acceptance_criteria_json)),
      depends_on_tickets: JSON.parse(String(row.depends_on_tickets_json)),
      kanban_column: row.kanban_column,
      priority: row.priority,
      assignee_session_id: row.assignee_session_id ? String(row.assignee_session_id) : null,
      reviewer_session_ids: JSON.parse(String(row.reviewer_session_ids_json)),
      repo_root_path: row.repo_root_path ? String(row.repo_root_path) : undefined,
      base_branch: String(row.base_branch),
      retry_count: Number(row.retry_count),
      max_retries: Number(row.max_retries),
      failure_notes: JSON.parse(String(row.failure_notes_json)),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    });
  }
}
