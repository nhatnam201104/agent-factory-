import type { SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import type React from "react";
import { useState } from "react";
import { type AgentStatusInfo, POSE_LABELS, truncate } from "./agentStatus.js";

const BUBBLE_MAX = 34;
const TICKET_MIME = "application/x-arena-ticket-id";

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

function bubbleText(
  emp: SessionEmployee,
  status: AgentStatusInfo,
  ticket: TaskTicket | null,
): string | null {
  if (status.activity === "needs_approval") return "✋ Cần bạn duyệt quyền";
  if (status.activity !== "working") return null;
  return ticket ? `💻 ${truncate(ticket.title, BUBBLE_MAX)}` : POSE_LABELS[emp.avatar_pose];
}

export function AgentTag(props: {
  employee: SessionEmployee;
  status: AgentStatusInfo;
  currentTicket: TaskTicket | null;
  selected: boolean;
  tagRef: (el: HTMLDivElement | null) => void;
  onSelect: (employeeId: string) => void;
  onDropTicket?: (ticketId: string, employeeId: string) => void;
}) {
  const { employee, status, currentTicket, selected, tagRef, onSelect, onDropTicket } = props;
  const [dropActive, setDropActive] = useState(false);
  const bubble = bubbleText(employee, status, currentTicket);

  const handleDrop = (e: React.DragEvent) => {
    if (!onDropTicket) return;
    e.preventDefault();
    setDropActive(false);
    const ticketId = (
      e.dataTransfer.getData(TICKET_MIME) ||
      e.dataTransfer.getData("text/plain") ||
      ""
    ).trim();
    if (ticketId) onDropTicket(ticketId, employee.id);
  };

  const className = [
    "agent-tag",
    `is-${status.activity}`,
    selected ? "is-selected" : "",
    dropActive ? "is-drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} ref={tagRef} style={{ "--status": status.css } as CssVars}>
      {bubble ? <div className="agent-tag__bubble">{bubble}</div> : null}
      <button
        type="button"
        data-testid={`employee-badge-${employee.employee_code}`}
        className="agent-tag__badge"
        title={`${employee.display_name} [${employee.employee_code}] · ${status.label}`}
        aria-label={`${employee.display_name}, ${status.label}. Bấm để xem việc và giao việc`}
        aria-pressed={selected}
        onClick={() => onSelect(employee.id)}
        onDragOver={(e) => {
          if (!onDropTicket) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        <span className="agent-tag__dot" aria-hidden="true" />
        <span className="agent-tag__name">{employee.display_name}</span>
        <span className="agent-tag__emoji" aria-hidden="true">
          {status.emoji}
        </span>
      </button>
    </div>
  );
}
