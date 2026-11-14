import type { DecisionRecord, TaskTicket } from "@factory-arena/protocol";
import React, { useEffect } from "react";
import { DissentPanel } from "./DissentPanel.js";

export interface DecisionMinutesModalProps {
  open: boolean;
  decision: DecisionRecord | null;
  roomTitle?: string;
  decomposedTickets?: TaskTicket[];
  onApproveGate?: () => void;
  onClose: () => void;
}

export function DecisionMinutesModal({
  open,
  decision,
  roomTitle,
  decomposedTickets = [],
  onApproveGate,
  onClose,
}: DecisionMinutesModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !decision) {
    return null;
  }

  const childBeads = decomposedTickets.filter((t) => t.decision_id === decision.id);

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Biên bản Quyết định Hội đồng"
      data-testid="decision-minutes-modal"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        margin: 0,
        border: "none",
        color: "var(--text)",
        zIndex: 60,
        background: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          maxHeight: "86vh",
          overflowY: "auto",
          border: "1px solid var(--accent)",
        }}
      >
        <h2>
          <span>📜 Biên bản Quyết định: {roomTitle ?? decision.room_id}</span>
          <button type="button" className="btn" onClick={onClose} data-testid="btn-close-minutes">
            ✕ Đóng
          </button>
        </h2>

        <div style={{ fontSize: "0.83rem", marginBottom: 10 }}>
          🏆 Phương án thắng: <strong>{decision.winning_alias}</strong> · Cơ chế:{" "}
          <code>{decision.resolution_method}</code>
          {decision.human_approved_by ? (
            <span style={{ marginLeft: 8, color: "var(--ok)" }}>
              · Đã ký bởi <strong>{decision.human_approved_by}</strong>
            </span>
          ) : (
            <span style={{ marginLeft: 8, color: "var(--warn)" }}>· Chờ Giám đốc ký duyệt</span>
          )}
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            fontSize: "0.82rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {decision.final_plan_markdown}
        </div>

        {decision.adopted_amendments.length > 0 ? (
          <div style={{ marginTop: 10, fontSize: "0.8rem" }}>
            <strong>
              ✨ Điều khoản Bổ sung đã Tiếp thu ({decision.adopted_amendments.length}):
            </strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {decision.adopted_amendments.map((amendment) => (
                <li key={amendment}>{amendment}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <DissentPanel dissentLog={decision.dissent_log} />

        <div style={{ marginTop: 12, fontSize: "0.8rem" }}>
          <strong>🧩 Task Beads phân rã tự động ({childBeads.length}):</strong>
          {childBeads.length === 0 ? (
            <div style={{ color: "var(--muted)", marginTop: 4 }}>
              Các phiếu việc con (`TaskTicket`) sẽ được sinh tự động ngay khi Giám đốc bấm Ký duyệt
              Human Gate.
            </div>
          ) : (
            <ul data-testid="decomposed-beads-list" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {childBeads.map((bead) => (
                <li key={bead.id}>
                  <code>{bead.id}</code> {bead.title} ({bead.kanban_column})
                </li>
              ))}
            </ul>
          )}
        </div>

        {!decision.human_approved_by && onApproveGate ? (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="btn-modal-approve-gate"
              onClick={() => {
                onApproveGate();
                onClose();
              }}
            >
              ✅ Ký duyệt & Phân rã Task Beads
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
