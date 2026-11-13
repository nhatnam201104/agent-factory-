import type { KanbanColumn, SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import React from "react";
import { OrgChartTree } from "./OrgChartTree.js";

const COLUMNS: Array<{ key: KanbanColumn; label: string }> = [
  { key: "backlog", label: "📥 Backlog / Assigned" },
  { key: "in_progress", label: "💻 Đang làm tại Bàn (Worktree)" },
  { key: "in_war_room_debate", label: "⚖️ Họp Phản Biện / Blocked" },
  { key: "done", label: "✅ Hoàn thành" }
];

export function KanbanBoard(props: {
  tickets: TaskTicket[];
  employees: SessionEmployee[];
  onUpdateTicket: (
    ticketId: string,
    patch: { assignee_session_id?: string | null; kanban_column?: KanbanColumn }
  ) => void;
}) {
  return (
    <div className="card" data-testid="kanban-board">
      <h2>📋 Bảng Quản lý Công việc Công ty (Kanban & Org Chart)</h2>
      <OrgChartTree employees={props.employees} />
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

          return (
            <div key={col.key} className="kanban-col">
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  color: "var(--accent)",
                  marginBottom: 8,
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <span>{col.label}</span>
                <span>{items.length}</span>
              </div>
              {items.map((ticket) => (
                <div
                  key={ticket.id}
                  className="ticket-item"
                  data-testid={`ticket-card-${ticket.id}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <code>{ticket.id}</code>
                    <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                      {ticket.priority}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, margin: "4px 0 6px" }}>{ticket.title}</div>
                  <select
                    aria-label={`Assign ${ticket.id}`}
                    value={ticket.assignee_session_id ?? ""}
                    onChange={(e) =>
                      props.onUpdateTicket(ticket.id, {
                        assignee_session_id: e.target.value || null,
                        kanban_column: "in_progress"
                      })
                    }
                    style={{
                      width: "100%",
                      background: "#091022",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      padding: "4px 6px",
                      fontSize: "0.76rem"
                    }}
                  >
                    <option value="">-- Chưa phân công --</option>
                    {props.employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        👤 {emp.display_name} ({emp.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
