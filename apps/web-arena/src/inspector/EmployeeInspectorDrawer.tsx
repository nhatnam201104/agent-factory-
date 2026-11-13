import type { PermissionRequest, SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import React from "react";

export function EmployeeInspectorDrawer(props: {
  employee: SessionEmployee | null;
  tickets: TaskTicket[];
  pendingPermissions: PermissionRequest[];
  onResolvePermission: (permissionId: string, decision: "allowed" | "denied") => void;
}) {
  const { employee, tickets, pendingPermissions, onResolvePermission } = props;
  if (!employee) {
    return (
      <div className="card">
        <h2>🪪 Session Employee Inspector</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Chọn một nhân viên trong Văn phòng 3D để xem chi tiết phiên.
        </p>
      </div>
    );
  }

  const assigned = tickets.filter((t) => t.assignee_session_id === employee.id);
  const perms = pendingPermissions.filter((p) => p.session_employee_id === employee.id);
  const fillWarn = employee.context_fill_pct > 40;

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
        Phiếu việc đang nhận:{" "}
        <strong>{assigned.map((t) => t.id).join(", ") || "Chưa gán"}</strong>
      </div>
      <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
        Trạng thái thật: <code>{employee.last_tool_call_summary ?? employee.avatar_pose}</code>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.78rem",
          marginTop: 10
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
            background: fillWarn ? "var(--warn)" : "var(--accent)"
          }}
        />
      </div>

      {perms.map((perm) => (
        <div
          key={perm.id}
          data-testid={`permission-card-${perm.id}`}
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--warn)",
            background: "rgba(251, 191, 36, 0.14)"
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
