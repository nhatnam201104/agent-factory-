import type { PermissionRequest, SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import type React from "react";
import { useState } from "react";

export interface EmployeeCommandRecord {
  id: string;
  employee_id: string;
  employee_code: string;
  ticket_id: string | null;
  prompt: string;
  response_markdown: string;
  execution_mode: string;
  created_at: string;
}

export function EmployeeInspectorDrawer(props: {
  employee: SessionEmployee | null;
  tickets: TaskTicket[];
  pendingPermissions: PermissionRequest[];
  commandLogs?: EmployeeCommandRecord[];
  onResolvePermission: (permissionId: string, decision: "allowed" | "denied") => void;
  onSendEmployeeCommand?: (employeeId: string, prompt: string) => Promise<void>;
}) {
  const {
    employee,
    tickets,
    pendingPermissions,
    commandLogs = [],
    onResolvePermission,
    onSendEmployeeCommand,
  } = props;
  const [directPrompt, setDirectPrompt] = useState("");
  const [sending, setSending] = useState(false);

  if (!employee) {
    return (
      <div className="card">
        <h2>🪪 Session Employee Inspector</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Chọn một nhân viên trong Văn phòng 3D để xem chi tiết phiên và giao lệnh trực tiếp.
        </p>
      </div>
    );
  }

  const assigned = tickets.filter((t) => t.assignee_session_id === employee.id);
  const perms = pendingPermissions.filter((p) => p.session_employee_id === employee.id);
  const myLogs = commandLogs.filter((l) => l.employee_id === employee.id).slice(0, 5);
  const fillWarn = employee.context_fill_pct > 40;

  const handleSendDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = directPrompt.trim();
    if (!trimmed || !onSendEmployeeCommand || sending) return;
    setSending(true);
    try {
      await onSendEmployeeCommand(employee.id, trimmed);
      setDirectPrompt("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" data-testid="employee-inspector">
      <h2>
        <span>
          🪪 {employee.display_name} <code>{employee.employee_code}</code>
        </span>
        <code>{employee.transport_type}</code>
      </h2>
      <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: 8 }}>
        {employee.job_title} · Bàn: <code>{employee.desk_slot_id}</code> · Khu vực:{" "}
        <code>{employee.spatial_zone}</code>
      </div>
      <div style={{ fontSize: "0.82rem" }}>
        Phiếu việc đang nhận: <strong>{assigned.map((t) => t.id).join(", ") || "Chưa gán"}</strong>
      </div>
      <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
        Trạng thái thật: <code>{employee.last_tool_call_summary ?? employee.avatar_pose}</code>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.78rem",
          marginTop: 10,
        }}
      >
        <span>
          Context Fill: <strong>{employee.context_fill_pct}%</strong>
        </span>
        <span>
          Payroll: <strong>${employee.session_cost_usd.toFixed(2)}</strong> / $
          {employee.max_session_budget_usd.toFixed(2)}
        </span>
      </div>
      <div className="meter">
        <div
          style={{
            width: `${Math.min(100, employee.context_fill_pct)}%`,
            background: fillWarn ? "var(--warn)" : "var(--accent)",
          }}
        />
      </div>

      {onSendEmployeeCommand ? (
        <form
          onSubmit={handleSendDirect}
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 5 }}>
            💬 Giao lệnh trực tiếp cho {employee.display_name}:
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              data-testid="employee-direct-command-input"
              value={directPrompt}
              onChange={(e) => setDirectPrompt(e.target.value)}
              placeholder={`Nhắn lệnh cho ${employee.employee_code}...`}
              style={{
                flex: 1,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 6,
                padding: "6px 9px",
                fontSize: "0.8rem",
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || !directPrompt.trim()}
              data-testid="btn-send-employee-command"
            >
              {sending ? "..." : "▶ Giao"}
            </button>
          </div>
        </form>
      ) : null}

      {myLogs.length > 0 ? (
        <div
          data-testid="employee-command-logs"
          style={{
            marginTop: 8,
            maxHeight: 150,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {myLogs.map((log) => (
            <div
              key={log.id}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                background: "var(--surface-sunken)",
                border: "1px solid var(--border)",
                fontSize: "0.76rem",
              }}
            >
              <div style={{ color: "var(--accent)" }}>
                <strong>Bạn:</strong> {log.prompt}{" "}
                {log.ticket_id ? <code>{log.ticket_id}</code> : null}
              </div>
              <div style={{ marginTop: 3, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                <strong>{employee.employee_code}:</strong> {log.response_markdown}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {perms.map((perm) => (
        <div
          key={perm.id}
          data-testid={`permission-card-${perm.id}`}
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--warn)",
            background: "var(--warn-soft)",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--warn)", fontSize: "0.82rem" }}>
            ✋ Đang giơ tay xin quyền ({perm.request_kind}):
          </div>
          <div style={{ fontSize: "0.8rem", margin: "4px 0 8px" }}>{perm.prompt_summary}</div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="btn-allow-permission"
            onClick={() => onResolvePermission(perm.id, "allowed")}
          >
            ✓ Allow ngay tại bàn
          </button>
          <button
            type="button"
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={() => onResolvePermission(perm.id, "denied")}
          >
            ✕ Deny
          </button>
        </div>
      ))}
    </div>
  );
}
