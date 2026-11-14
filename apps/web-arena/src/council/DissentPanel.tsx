import type { DissentEntry } from "@factory-arena/protocol";
import React from "react";

export interface DissentPanelProps {
  dissentLog: DissentEntry[];
}

export function DissentPanel({ dissentLog }: DissentPanelProps) {
  if (dissentLog.length === 0) {
    return (
      <div
        data-testid="dissent-panel-empty"
        style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--muted)" }}
      >
        Không có ý kiến bảo lưu thiểu số nào trong phiên họp này.
      </div>
    );
  }

  return (
    <div
      data-testid="dissent-panel"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 7,
        background: "var(--warn-soft)",
        border: "1px solid var(--warn-line)",
        color: "var(--warn)",
        fontSize: "0.79rem",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        📌 Ý kiến Bảo lưu Thiểu số (DissentLog · {dissentLog.length})
      </div>
      {dissentLog.map((entry) => (
        <div
          key={`${entry.raised_by_alias}-${entry.issue}`}
          style={{ marginTop: 4, lineHeight: 1.4 }}
        >
          <strong>{entry.raised_by_alias}</strong>: {entry.issue}{" "}
          <span style={{ color: "var(--muted)" }}>
            (Xem lại khi: <code>{entry.revisit_trigger}</code>)
          </span>
        </div>
      ))}
    </div>
  );
}
