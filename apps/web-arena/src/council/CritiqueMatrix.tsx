import type { Critique, DecisionRecord, TaskTicket } from "@factory-arena/protocol";
import React, { useState } from "react";
import { DecisionMinutesModal } from "./DecisionMinutesModal.js";
import { DissentPanel } from "./DissentPanel.js";

export function CritiqueMatrix(props: {
  critiques: Critique[];
  decision?: DecisionRecord | null;
  roomTitle?: string;
  tickets?: TaskTicket[];
  onApproveGate?: () => void;
}) {
  const [minutesOpen, setMinutesOpen] = useState(false);

  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="critique-matrix">
      <h2>⚖️ Ma trận Chấm điểm Phản biện Ẩn danh & Biên bản Quyết định (DissentLog)</h2>
      {props.critiques.length === 0 && !props.decision ? (
        <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Bấm &ldquo;Triệu tập Họp Phản biện&rdquo; để các nhân viên đi bộ vào Phòng Họp Kính thực
          hiện chu trình 4 bước (Sealed Round 1 → Anonymized Critique → Vote → DecisionRecord).
        </div>
      ) : (
        <div>
          {props.critiques.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "8px 10px",
                background: "var(--surface-sunken)",
                borderRadius: 7,
                marginBottom: 8,
                fontSize: "0.8rem",
              }}
            >
              <strong>Đánh giá {c.target_anonymous_alias}</strong> · Điểm Rubric: Correctness{" "}
              {c.rubric_scores.correctness}/10 · Security {c.rubric_scores.security}/10 ·
              Maintainability {c.rubric_scores.maintainability}/10
              {c.findings.map((f) => (
                <div
                  key={`${f.severity}-${f.category}-${f.claim}`}
                  style={{ color: "var(--warn)", marginTop: 3 }}
                >
                  [{f.severity.toUpperCase()}] {f.claim}{" "}
                  {f.evidence_ref ? <code>{f.evidence_ref}</code> : null}
                </div>
              ))}
            </div>
          ))}
          {props.decision ? (
            <div
              data-testid="decision-record-box"
              style={{
                padding: 12,
                border: "1px solid var(--accent)",
                borderRadius: 8,
                background: "var(--accent-soft)",
                fontSize: "0.82rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  🏆 Phương án thắng: <strong>{props.decision.winning_alias}</strong> (
                  <code>{props.decision.resolution_method}</code>)
                </div>
                <button
                  type="button"
                  className="btn"
                  data-testid="btn-open-decision-minutes"
                  onClick={() => setMinutesOpen(true)}
                >
                  📜 Xem Biên bản & Task Beads
                </button>
              </div>
              <div style={{ marginTop: 4 }}>{props.decision.final_plan_markdown}</div>
              <DissentPanel dissentLog={props.decision.dissent_log} />
            </div>
          ) : null}
        </div>
      )}
      <DecisionMinutesModal
        open={minutesOpen}
        decision={props.decision ?? null}
        roomTitle={props.roomTitle}
        decomposedTickets={props.tickets}
        onApproveGate={props.onApproveGate}
        onClose={() => setMinutesOpen(false)}
      />
    </div>
  );
}
