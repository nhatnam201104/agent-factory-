import type { PermissionRequest, SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import type React from "react";
import { useEffect } from "react";
import { type AgentActions, AgentAssignForm } from "./AgentAssignForm.js";
import { DEPT_COLORS } from "./EmployeeAvatar.js";
import {
  COLUMN_LABELS,
  POSE_LABELS,
  PRIORITY_LABELS,
  currentTicketFor,
  deriveAgentStatus,
  openTicketsFor,
  truncate,
  workingEmployeeIds,
} from "./agentStatus.js";

export type { AgentActions } from "./AgentAssignForm.js";

const MAX_QUEUE = 4;

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

export function AgentQuickPanel(props: {
  employee: SessionEmployee;
  tickets: readonly TaskTicket[];
  pendingPermissions: readonly PermissionRequest[];
  actions: AgentActions;
  onClose: () => void;
}) {
  const { employee, tickets, pendingPermissions, actions, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pendingIds = new Set(pendingPermissions.map((p) => p.session_employee_id));
  const status = deriveAgentStatus(employee, pendingIds, workingEmployeeIds(tickets));
  const current = currentTicketFor(employee, tickets);
  const fullQueue = openTicketsFor(employee.id, tickets).filter((t) => t.id !== current?.id);
  const queue = fullQueue.slice(0, MAX_QUEUE);
  const hiddenCount = fullQueue.length - queue.length;
  const perms = pendingPermissions.filter((p) => p.session_employee_id === employee.id);
  const liveActivity = employee.last_tool_call_summary ?? POSE_LABELS[employee.avatar_pose];
  const deptColor = hexToCss(DEPT_COLORS[employee.department] ?? 0x8aa8ff);
  const budgetPct =
    employee.max_session_budget_usd > 0
      ? Math.min(100, (employee.session_cost_usd / employee.max_session_budget_usd) * 100)
      : 0;

  return (
    <aside
      className="agent-panel"
      data-testid="agent-quick-panel"
      aria-label={`Chi tiết ${employee.display_name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="agent-panel__head">
        <span className="agent-panel__avatar" style={{ "--dept": deptColor } as CssVars}>
          {initials(employee.display_name)}
        </span>
        <div className="agent-panel__who">
          <h3>{employee.display_name}</h3>
          <p>
            {employee.employee_code} · {employee.job_title}
          </p>
        </div>
        <button
          type="button"
          className="agent-panel__close"
          aria-label="Đóng bảng chi tiết"
          data-testid="agent-panel-close"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="agent-panel__chips">
        <span className="status-chip" style={{ "--status": status.css } as CssVars}>
          {status.emoji} {status.label}
        </span>
        <span className="meta-chip">{employee.transport_type}</span>
        {employee.model_identifier ? (
          <span className="meta-chip">{truncate(employee.model_identifier, 22)}</span>
        ) : null}
      </div>

      <section className="agent-panel__section" aria-label="Việc đang làm">
        <h4>Đang làm</h4>
        {current ? (
          <div className="current-task" data-testid="agent-panel-current-task">
            <div className="current-task__title">{current.title}</div>
            <div className="current-task__meta">
              <code>{current.id}</code>
              <span className="tag">{COLUMN_LABELS[current.kanban_column]}</span>
              <span className={`tag prio-${current.priority}`}>
                {PRIORITY_LABELS[current.priority]}
              </span>
            </div>
            <div className="current-task__live">
              <span className="live-dot" aria-hidden="true" /> {truncate(liveActivity, 90)}
            </div>
          </div>
        ) : (
          <p className="agent-panel__empty">
            {status.activity === "offline"
              ? "Đang nghỉ ở lounge ☕ — phiên hiện offline."
              : "Đang rảnh 🌿 — giao một việc bên dưới nhé."}
          </p>
        )}
        {queue.length > 0 ? (
          <ul className="task-queue" aria-label="Hàng đợi">
            {queue.map((t) => (
              <li key={t.id}>
                <span>{truncate(t.title, 40)}</span>
                <span className="tag">{COLUMN_LABELS[t.kanban_column]}</span>
              </li>
            ))}
            {hiddenCount > 0 ? (
              <li className="task-queue__more">+{hiddenCount} phiếu khác</li>
            ) : null}
          </ul>
        ) : null}
      </section>

      {perms.map((perm) => (
        <section key={perm.id} className="perm-notice" aria-label="Yêu cầu cấp quyền">
          <div className="perm-notice__title">✋ Xin quyền · {perm.request_kind}</div>
          <p>{perm.prompt_summary}</p>
          <div className="perm-notice__actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="agent-panel-allow-permission"
              onClick={() => actions.resolvePermission(perm.id, "allowed")}
            >
              ✓ Cho phép
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => actions.resolvePermission(perm.id, "denied")}
            >
              ✕ Từ chối
            </button>
          </div>
        </section>
      ))}

      {/* Keyed by agent so drafts, replies and in-flight state never leak between agents. */}
      <AgentAssignForm key={employee.id} employee={employee} tickets={tickets} actions={actions} />

      <footer className="agent-panel__foot">
        <div>
          <span>Context</span>
          <div className="mini-meter">
            <div
              style={{
                width: `${Math.min(100, employee.context_fill_pct)}%`,
                background: employee.context_fill_pct > 40 ? "var(--warn)" : "var(--accent)",
              }}
            />
          </div>
          <strong>{employee.context_fill_pct}%</strong>
        </div>
        <div>
          <span>Chi phí</span>
          <div className="mini-meter">
            <div style={{ width: `${budgetPct}%`, background: "var(--accent-2)" }} />
          </div>
          <strong>${employee.session_cost_usd.toFixed(2)}</strong>
        </div>
      </footer>
    </aside>
  );
}
