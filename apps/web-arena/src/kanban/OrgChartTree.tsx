import type { SessionEmployee } from "@factory-arena/protocol";
import React, { useState } from "react";

export const DRAG_TICKET_MIME = "application/x-arena-ticket-id";

export function readDraggedTicketId(dt: DataTransfer): string {
  return (dt.getData(DRAG_TICKET_MIME) || dt.getData("text/plain") || "").trim();
}

export function OrgChartTree({
  employees,
  onDropTicketOnEmployee,
}: {
  employees: SessionEmployee[];
  onDropTicketOnEmployee?: (ticketId: string, employeeId: string) => void;
}) {
  const [dragTargetEmpId, setDragTargetEmpId] = useState<string | null>(null);

  const byDept = employees.reduce<Record<string, SessionEmployee[]>>((acc, emp) => {
    acc[emp.department] = acc[emp.department] ?? [];
    acc[emp.department].push(emp);
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      {Object.entries(byDept).map(([dept, list]) => (
        <div
          key={dept}
          style={{
            background: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: "0.76rem",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ color: "var(--accent)", textTransform: "uppercase" }}>{dept}:</strong>
          {list.map((e) => {
            const isOver = dragTargetEmpId === e.id;
            return (
              <span
                key={e.id}
                data-testid={`org-emp-drop-${e.employee_code}`}
                onDragOver={(ev) => {
                  if (!onDropTicketOnEmployee) return;
                  ev.preventDefault();
                  setDragTargetEmpId(e.id);
                }}
                onDragLeave={() => {
                  setDragTargetEmpId((prev) => (prev === e.id ? null : prev));
                }}
                onDrop={(ev) => {
                  if (!onDropTicketOnEmployee) return;
                  ev.preventDefault();
                  setDragTargetEmpId(null);
                  const ticketId = readDraggedTicketId(ev.dataTransfer);
                  if (ticketId) {
                    onDropTicketOnEmployee(ticketId, e.id);
                  }
                }}
                style={{
                  padding: "2px 7px",
                  borderRadius: 6,
                  border: isOver ? "1px dashed var(--accent)" : "1px solid transparent",
                  background: isOver ? "var(--accent-soft)" : "var(--surface-2)",
                }}
                title="Kéo-thả phiếu việc vào đây để giao trực tiếp cho nhân viên này"
              >
                👤 {e.display_name} (<code>{e.employee_code}</code>)
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
