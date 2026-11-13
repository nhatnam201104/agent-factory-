import type { SessionEmployee, WarRoomMeeting } from "@factory-arena/protocol";
import React, { useState } from "react";

export function DirectorDeskHUD(props: {
  employees: SessionEmployee[];
  rooms: Array<WarRoomMeeting & { latest_decision?: any }>;
  onSteerRoom: (
    roomId: string,
    action: "inject_guidance" | "approve_decision" | "reject_and_reopen" | "abort_room",
    guidance?: string
  ) => void;
}) {
  const [guidanceText, setGuidanceText] = useState("");
  const totalCost = props.employees.reduce((s, e) => s + e.session_cost_usd, 0);
  const activeRoom = props.rooms[0];

  return (
    <div className="card" data-testid="director-desk-hud">
      <h2>
        <span>👔 Bàn Giám Đốc (Director Desk & Payroll Gate)</span>
        <span style={{ color: "var(--accent)", fontSize: "0.84rem" }}>
          Tổng Payroll: ${totalCost.toFixed(2)}
        </span>
      </h2>
      {activeRoom ? (
        <div style={{ fontSize: "0.82rem" }}>
          <div>
            Phòng họp đang mở: <strong>{activeRoom.title}</strong> · Trạng thái:{" "}
            <code data-testid="active-room-status">{activeRoom.status}</code>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Nhập chỉ thị nóng (Steer guidance)..."
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
              style={{
                flex: 1,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 6,
                padding: "6px 10px"
              }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!guidanceText.trim()) return;
                props.onSteerRoom(activeRoom.id, "inject_guidance", guidanceText.trim());
                setGuidanceText("");
              }}
            >
              📣 Gửi Steer
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="btn-approve-human-gate"
              onClick={() => props.onSteerRoom(activeRoom.id, "approve_decision")}
            >
              ✅ Ký duyệt Human Gate
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Chưa có phiên Phòng Họp Kính nào đang chờ ký duyệt.
        </div>
      )}
    </div>
  );
}
