import type {
  BlackboardArtifact,
  KanbanColumn,
  SessionEmployee,
  TaskTicket,
  WorkspaceLease,
} from "@factory-arena/protocol";
import React, { useMemo, useState } from "react";
import { DRAG_TICKET_MIME, OrgChartTree, readDraggedTicketId } from "./OrgChartTree.js";

const COLUMNS: Array<{ key: KanbanColumn; label: string }> = [
  { key: "backlog", label: "📥 Backlog / Assigned" },
  { key: "in_progress", label: "💻 Đang làm tại Bàn (Worktree)" },
  { key: "in_war_room_debate", label: "⚖️ Họp Phản Biện / Blocked" },
  { key: "done", label: "✅ Hoàn thành" },
];

export function TicketCard(props: {
  ticket: TaskTicket;
  parentTicket?: TaskTicket | null;
  employees: SessionEmployee[];
  lease?: WorkspaceLease | null;
  artifacts: BlackboardArtifact[];
  onUpdateTicket: (
    ticketId: string,
    patch: { assignee_session_id?: string | null; kanban_column?: KanbanColumn },
  ) => void;
}) {
  const { ticket, parentTicket, employees, lease, artifacts } = props;
  const assignedEmployee = employees.find((e) => e.id === ticket.assignee_session_id) ?? null;

  const branchLabel = lease?.branch_name
    ? lease.branch_name
    : lease?.isolation_mode === "file_lock"
      ? `file-lock (${lease.locked_globs.join(", ") || "*"})`
      : assignedEmployee && ticket.kanban_column !== "backlog"
        ? `arena/office/${ticket.id}-${assignedEmployee.employee_code}`
        : null;

  const diffArtifacts = artifacts.filter((a) => a.kind === "code_diff");

  return (
    <div
      className="ticket-item"
      data-testid={`ticket-card-${ticket.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_TICKET_MIME, ticket.id);
        e.dataTransfer.setData("text/plain", ticket.id);
      }}
      style={{ cursor: "grab" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <code>{ticket.id}</code>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{ticket.priority}</span>
      </div>

      {ticket.parent_ticket_id ? (
        <div
          data-testid={`ticket-ancestry-${ticket.id}`}
          style={{
            marginTop: 4,
            fontSize: "0.71rem",
            color: "var(--accent-2)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <span>
            🎯 Goal Ancestry: <code>{ticket.parent_ticket_id}</code>
            {parentTicket ? ` · ${parentTicket.title}` : ""}
          </span>
        </div>
      ) : null}

      <div style={{ fontWeight: 600, margin: "4px 0 6px" }}>{ticket.title}</div>

      <div
        style={{
          display: "flex",
          gap: 5,
          flexWrap: "wrap",
          marginBottom: branchLabel || artifacts.length > 0 ? 6 : 0,
        }}
      >
        {branchLabel ? (
          <span
            data-testid={`ticket-branch-${ticket.id}`}
            style={{
              fontSize: "0.7rem",
              padding: "2px 6px",
              borderRadius: 5,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-line)",
              color: "var(--accent)",
            }}
            title={`Base branch: ${ticket.base_branch}`}
          >
            🌿 {branchLabel}
          </span>
        ) : null}

        {artifacts.length > 0 ? (
          <span
            data-testid={`ticket-artifacts-${ticket.id}`}
            style={{
              fontSize: "0.7rem",
              padding: "2px 6px",
              borderRadius: 5,
              background: "var(--info-soft)",
              border: "1px solid var(--info-line)",
              color: "var(--info-ink)",
            }}
            title={artifacts.map((a) => `${a.kind}: ${a.compact_digest || a.title}`).join("\n")}
          >
            📎{" "}
            {diffArtifacts.length > 0
              ? `${diffArtifacts.length} Blackboard diff`
              : `${artifacts.length} Blackboard artifact`}
          </span>
        ) : null}
      </div>

      <select
        aria-label={`Assign ${ticket.id}`}
        value={ticket.assignee_session_id ?? ""}
        onChange={(e) =>
          props.onUpdateTicket(ticket.id, {
            assignee_session_id: e.target.value || null,
            kanban_column: e.target.value ? "in_progress" : "backlog",
          })
        }
        style={{
          width: "100%",
          background: "var(--field)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          padding: "4px 6px",
          fontSize: "0.76rem",
        }}
      >
        <option value="">-- Chưa phân công --</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            👤 {emp.display_name} ({emp.employee_code})
          </option>
        ))}
      </select>
    </div>
  );
}

export function KanbanBoard(props: {
  tickets: TaskTicket[];
  employees: SessionEmployee[];
  leases?: WorkspaceLease[];
  artifacts?: BlackboardArtifact[];
  onCreateTicket?: (input: {
    title: string;
    assignee_session_id?: string | null;
    priority?: "p0_critical" | "p1_high" | "p2_normal" | "p3_low";
  }) => Promise<void>;
  onUpdateTicket: (
    ticketId: string,
    patch: { assignee_session_id?: string | null; kanban_column?: KanbanColumn },
  ) => void;
}) {
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newPriority, setNewPriority] = useState<
    "p0_critical" | "p1_high" | "p2_normal" | "p3_low"
  >("p1_high");

  const ticketById = useMemo(() => new Map(props.tickets.map((t) => [t.id, t])), [props.tickets]);

  const leaseByTicketId = useMemo(() => {
    const map = new Map<string, WorkspaceLease>();
    for (const lease of props.leases ?? []) {
      map.set(lease.ticket_id, lease);
    }
    return map;
  }, [props.leases]);

  const artifactsByTicketId = useMemo(() => {
    const map = new Map<string, BlackboardArtifact[]>();
    for (const art of props.artifacts ?? []) {
      if (!art.ticket_id) continue;
      const list = map.get(art.ticket_id) ?? [];
      list.push(art);
      map.set(art.ticket_id, list);
    }
    return map;
  }, [props.artifacts]);

  const handleAssignByDrop = (ticketId: string, employeeId: string) => {
    props.onUpdateTicket(ticketId, {
      assignee_session_id: employeeId,
      kanban_column: "in_progress",
    });
  };

  return (
    <div className="card" data-testid="kanban-board">
      <h2>
        <span>📋 Bảng Quản lý Công việc Công ty (Kanban & Org Chart)</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--muted)" }}>
          Kéo-thả thẻ sang cột khác hoặc thả vào nhân viên / bàn 3D để giao việc
        </span>
      </h2>
      <OrgChartTree employees={props.employees} onDropTicketOnEmployee={handleAssignByDrop} />

      {props.onCreateTicket ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const title = newTitle.trim();
            if (!title || !props.onCreateTicket) return;
            await props.onCreateTicket({
              title,
              assignee_session_id: newAssigneeId || null,
              priority: newPriority,
            });
            setNewTitle("");
          }}
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            data-testid="kanban-new-ticket-input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="➕ Nhập đầu việc mới (Task Ticket) để thêm vào bảng hoặc giao ngay cho nhân viên..."
            style={{
              flex: 2,
              minWidth: 240,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: "0.8rem",
            }}
          />
          <select
            aria-label="Độ ưu tiên phiếu mới"
            value={newPriority}
            onChange={(e) =>
              setNewPriority(e.target.value as "p0_critical" | "p1_high" | "p2_normal" | "p3_low")
            }
            style={{
              background: "var(--field)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: "0.78rem",
            }}
          >
            <option value="p0_critical">p0_critical</option>
            <option value="p1_high">p1_high</option>
            <option value="p2_normal">p2_normal</option>
            <option value="p3_low">p3_low</option>
          </select>
          <select
            aria-label="Giao cho nhân viên"
            value={newAssigneeId}
            onChange={(e) => setNewAssigneeId(e.target.value)}
            style={{
              background: "var(--field)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: "0.78rem",
            }}
          >
            <option value="">📥 Để trong Backlog</option>
            {props.employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                👤 Giao ngay: {emp.display_name} ({emp.employee_code})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!newTitle.trim()}
            data-testid="btn-create-ticket"
          >
            + Tạo Task
          </button>
        </form>
      ) : null}

      <div className="kanban-cols">
        {COLUMNS.map((col) => {
          const items = props.tickets.filter((t) => {
            if (col.key === "backlog") {
              return t.kanban_column === "backlog" || t.kanban_column === "assigned";
            }
            if (col.key === "in_war_room_debate") {
              return (
                t.kanban_column === "in_war_room_debate" ||
                t.kanban_column === "blocked" ||
                t.kanban_column === "director_gate" ||
                t.kanban_column === "in_review"
              );
            }
            return t.kanban_column === col.key;
          });

          const isOver = dragOverColumn === col.key;

          return (
            <div
              key={col.key}
              className="kanban-col"
              data-testid={`kanban-col-${col.key}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverColumn(col.key);
              }}
              onDragLeave={() => {
                setDragOverColumn((prev) => (prev === col.key ? null : prev));
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverColumn(null);
                const draggedId = readDraggedTicketId(e.dataTransfer);
                if (draggedId) {
                  props.onUpdateTicket(draggedId, { kanban_column: col.key });
                }
              }}
              style={{
                borderColor: isOver ? "var(--accent)" : undefined,
                background: isOver ? "var(--accent-soft)" : undefined,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  color: "var(--accent)",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{col.label}</span>
                <span>{items.length}</span>
              </div>
              {items.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  parentTicket={
                    ticket.parent_ticket_id
                      ? (ticketById.get(ticket.parent_ticket_id) ?? null)
                      : null
                  }
                  employees={props.employees}
                  lease={leaseByTicketId.get(ticket.id) ?? null}
                  artifacts={artifactsByTicketId.get(ticket.id) ?? []}
                  onUpdateTicket={props.onUpdateTicket}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
