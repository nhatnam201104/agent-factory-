import type { Critique, DecisionRecord } from "@factory-arena/protocol";
import React from "react";

export function CritiqueMatrix(props: {
  critiques: Critique[];
  decision?: DecisionRecord | null;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="critique-matrix">
      <h2>⚖️ Ma trận Chấm điểm Phản biện Ẩn danh & Biên bản Quyết định (DissentLog)</h2>
      {props.critiques.length === 0 && !props.decision ? (
        <div style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Bấm &ldquo;Triệu tập Họp Phản biện&rdquo; để các nhân viên đi bộ vào Phòng Họp Kính thực hiện
          chu trình 4 bước (Sealed Round 1 → Anonymized Critique → Vote → DecisionRecord).
        </div>
      ) : (
        <div>
          {props.critiques.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "8px 10px",
                background: "#0c1428",
                borderRadius: 7,
                marginBottom: 8,
                fontSize: "0.8rem"
              }}
            >
              <strong>Đánh giá {c.target_anonymous_alias}</strong> · Điểm Rubric: Correctness{" "}
              {c.rubric_scores.correctness}/10 · Security {c.rubric_scores.security}/10 ·
              Maintainability {c.rubric_scores.maintainability}/10
              {c.findings.map((f, i) => (
                <div key={i} style={{ color: "var(--warn)", marginTop: 3 }}>
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
                background: "rgba(56, 242, 200, 0.08)",
                fontSize: "0.82rem"
              }}
            >
              <div>
                🏆 Phương án thắng: <strong>{props.decision.winning_alias}</strong> (
                <code>{props.decision.resolution_method}</code>)
              </div>
              <div style={{ marginTop: 4 }}>{props.decision.final_plan_markdown}</div>
              {props.decision.dissent_log.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--warn)" }}>
                  📌 Ý kiến Bảo lưu (DissentLog):{" "}
                  {props.decision.dissent_log
                    .map((d) => `${d.raised_by_alias}: ${d.issue} (Xem lại khi: ${d.revisit_trigger})`)
                    .join(" | ")}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
