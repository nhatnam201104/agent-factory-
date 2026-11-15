import type { SessionEmployee, WarRoomMeeting } from "@factory-arena/protocol";
import type React from "react";
import { useState } from "react";
import { findOpenRoom } from "../council/roomStatus.js";

export function DirectorDeskHUD(props: {
  employees: SessionEmployee[];
  selectedEmployeeId: string | null;
  rooms: Array<WarRoomMeeting & { latest_decision?: any }>;
  onDispatchCommand: (params: {
    mode: "direct_employee" | "council_debate" | "kanban_backlog";
    prompt: string;
    targetEmployeeId?: string;
  }) => Promise<string | undefined>;
  onSteerRoom: (
    roomId: string,
    action: "inject_guidance" | "approve_decision" | "reject_and_reopen" | "abort_room",
    guidance?: string,
  ) => void;
  /** Ends every open meeting and sends all participants back to their desks. */
  onDisbandAll: () => void;
}) {
  const [commandMode, setCommandMode] = useState<
    "direct_employee" | "council_debate" | "kanban_backlog"
  >("direct_employee");
  const [commandText, setCommandText] = useState("");
  const [targetEmpId, setTargetEmpId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [guidanceText, setGuidanceText] = useState("");

  const totalCost = props.employees.reduce((s, e) => s + e.session_cost_usd, 0);
  const activeRoom = findOpenRoom(props.rooms);
  const effectiveTargetId = targetEmpId || props.selectedEmployeeId || props.employees[0]?.id || "";

  const handleSubmitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setLastFeedback(null);
    try {
      const msg = await props.onDispatchCommand({
        mode: commandMode,
        prompt: trimmed,
        targetEmployeeId: effectiveTargetId,
      });
      setCommandText("");
      if (msg) setLastFeedback(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" data-testid="director-desk-hud">
      <h2>
        <span>👔 Bàn Giám Đốc — Trung tâm Ra lệnh (Command Center)</span>
        <span style={{ color: "var(--accent)", fontSize: "0.84rem" }}>
          Payroll: ${totalCost.toFixed(2)}
        </span>
      </h2>

      <form onSubmit={handleSubmitCommand} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <select
            aria-label="Chế độ ra lệnh"
            data-testid="director-command-mode"
            value={commandMode}
            onChange={(e) =>
              setCommandMode(
                e.target.value as "direct_employee" | "council_debate" | "kanban_backlog",
              )
            }
            style={{
              flex: 1,
              minWidth: 190,
              background: "var(--field)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: "0.78rem",
            }}
          >
            <option value="direct_employee">🎯 Giao lệnh trực tiếp cho 1 Nhân viên AI</option>
            <option value="council_debate">⚖️ Triệu tập Hội đồng Phản biện về chủ đề này</option>
            <option value="kanban_backlog">📋 Tạo Phiếu việc mới vào Bảng Kanban</option>
          </select>

          {commandMode === "direct_employee" ? (
            <select
              aria-label="Nhân viên nhận lệnh"
              data-testid="director-command-target"
              value={effectiveTargetId}
              onChange={(e) => setTargetEmpId(e.target.value)}
              style={{
                flex: 1,
                minWidth: 160,
                background: "var(--field)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 8px",
                fontSize: "0.78rem",
              }}
            >
              {props.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  👤 {emp.display_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            data-testid="director-command-input"
            placeholder={
              commandMode === "council_debate"
                ? "Nhập chủ đề / bài toán kiến trúc cần các AI vào phòng họp phản biện..."
                : commandMode === "kanban_backlog"
                  ? "Nhập nội dung đầu việc cần thêm vào Backlog..."
                  : "Nhập lệnh hoặc câu hỏi giao cho nhân viên AI thực thi..."
            }
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            style={{
              flex: 1,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: "0.82rem",
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={sending || !commandText.trim()}
            data-testid="btn-send-director-command"
          >
            {sending ? "⏳ Đang gửi..." : "🚀 Ra lệnh"}
          </button>
        </div>

        {lastFeedback ? (
          <div
            data-testid="director-command-feedback"
            style={{
              marginTop: 8,
              padding: "7px 10px",
              borderRadius: 7,
              background: "var(--surface-sunken)",
              border: "1px solid var(--border)",
              fontSize: "0.78rem",
              whiteSpace: "pre-wrap",
              maxHeight: 130,
              overflowY: "auto",
            }}
          >
            {lastFeedback}
          </div>
        ) : null}
      </form>

      {activeRoom ? (
        <div
          style={{
            fontSize: "0.82rem",
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div>
            Phòng họp đang mở: <strong>{activeRoom.title}</strong> · Trạng thái:{" "}
            <code data-testid="active-room-status">{activeRoom.status}</code>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Nhập chỉ thị nóng giữa cuộc họp (Steer guidance)..."
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
              style={{
                flex: 1,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 6,
                padding: "6px 10px",
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
            <button
              type="button"
              className="btn"
              data-testid="btn-disband-room"
              title="Kết thúc cuộc họp và cho mọi người về lại bàn làm việc"
              onClick={props.onDisbandAll}
            >
              🛑 Giải tán
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          💡 Mẹo: Gõ lệnh ở ô trên rồi bấm <strong>🚀 Ra lệnh</strong> để giao việc cho từng nhân
          viên hoặc triệu tập Hội đồng Phản biện với chủ đề bất kỳ.
        </div>
      )}
    </div>
  );
}
