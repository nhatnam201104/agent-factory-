import type { SessionEmployee, TaskTicket, TicketPriority } from "@factory-arena/protocol";
import type React from "react";
import { useState } from "react";
import { PRIORITY_LABELS, assignableTickets, truncate } from "./agentStatus.js";

export interface AgentActions {
  assignTicket: (ticketId: string, employeeId: string) => Promise<void>;
  createTask: (employeeId: string, title: string, priority: TicketPriority) => Promise<void>;
  sendCommand: (employeeId: string, prompt: string) => Promise<string>;
  resolvePermission: (permissionId: string, decision: "allowed" | "denied") => void;
}

type AssignMode = "new_task" | "backlog" | "command";
type Feedback = { kind: "ok" | "error"; text: string } | null;

const MODES: ReadonlyArray<{ id: AssignMode; label: string; hint: string }> = [
  { id: "new_task", label: "✚ Task mới", hint: "Tạo phiếu việc và giao thẳng cho agent." },
  { id: "backlog", label: "📥 Từ backlog", hint: "Lấy một phiếu chưa có người nhận." },
  { id: "command", label: "💬 Nhắn lệnh", hint: "Gửi prompt trực tiếp vào phiên AI." },
];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as TicketPriority[];
const MAX_TITLE = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Có lỗi không xác định, thử lại nhé.";
}

export function AgentAssignForm(props: {
  employee: SessionEmployee;
  tickets: readonly TaskTicket[];
  actions: AgentActions;
}) {
  const { employee, tickets, actions } = props;
  const [mode, setMode] = useState<AssignMode>("new_task");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("p1_high");
  const [ticketId, setTicketId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reply, setReply] = useState<string | null>(null);

  const backlog = assignableTickets(tickets);
  const selectedTicketId = backlog.some((t) => t.id === ticketId)
    ? ticketId
    : (backlog[0]?.id ?? "");
  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setFeedback(null);
    try {
      const text = await task();
      setFeedback({ kind: "ok", text });
    } catch (error: unknown) {
      setFeedback({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "new_task") {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        await actions.createTask(employee.id, trimmed, priority);
        setTitle("");
        return `Đã giao “${truncate(trimmed, 48)}” cho ${employee.display_name}.`;
      });
    } else if (mode === "backlog") {
      const ticket = backlog.find((t) => t.id === selectedTicketId);
      if (!ticket) return;
      void run(async () => {
        await actions.assignTicket(ticket.id, employee.id);
        return `Đã chuyển phiếu ${ticket.id} sang ${employee.display_name}.`;
      });
    } else {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      void run(async () => {
        const response = await actions.sendCommand(employee.id, trimmed);
        setPrompt("");
        setReply(response);
        return "Đã gửi lệnh — xem phản hồi bên dưới.";
      });
    }
  };

  const canSubmit =
    !busy &&
    ((mode === "new_task" && title.trim().length > 0) ||
      (mode === "backlog" && Boolean(selectedTicketId)) ||
      (mode === "command" && prompt.trim().length > 0));

  return (
    <section className="agent-panel__section" aria-label="Giao việc">
      <h4>Giao việc</h4>
      <fieldset className="segmented">
        <legend className="visually-hidden">Cách giao việc</legend>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            data-testid={`agent-panel-tab-${m.id}`}
            className={mode === m.id ? "is-active" : undefined}
            onClick={() => {
              setMode(m.id);
              setFeedback(null);
            }}
          >
            {m.label}
          </button>
        ))}
      </fieldset>
      <p className="agent-panel__hint">{activeMode?.hint}</p>

      <form className="assign-form" onSubmit={handleSubmit}>
        {mode === "new_task" ? (
          <>
            <input
              type="text"
              data-testid="agent-panel-task-title"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Viết test cho API đăng nhập"
              aria-label="Tên task"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              aria-label="Độ ưu tiên"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {mode === "backlog" ? (
          backlog.length > 0 ? (
            <select
              data-testid="agent-panel-backlog-select"
              value={selectedTicketId}
              onChange={(e) => setTicketId(e.target.value)}
              aria-label="Chọn phiếu trong backlog"
            >
              {backlog.map((t) => (
                <option key={t.id} value={t.id}>
                  {PRIORITY_LABELS[t.priority].split(" ")[0]} · {truncate(t.title, 52)}
                </option>
              ))}
            </select>
          ) : (
            <p className="agent-panel__empty">Backlog đang trống — tạo “Task mới” thay thế nhé.</p>
          )
        ) : null}

        {mode === "command" ? (
          <textarea
            data-testid="agent-panel-command-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Nhắn cho ${employee.employee_code}…`}
            aria-label="Nội dung lệnh"
          />
        ) : null}

        <button
          type="submit"
          className="btn btn-primary assign-form__submit"
          data-testid="agent-panel-submit"
          disabled={!canSubmit}
        >
          {busy ? "Đang gửi…" : mode === "command" ? "Gửi lệnh" : "Giao cho agent"}
        </button>
      </form>

      {feedback ? (
        <output className={`assign-feedback is-${feedback.kind}`} aria-live="polite">
          {feedback.text}
        </output>
      ) : null}
      {mode === "command" && reply ? (
        <div className="assign-reply" data-testid="agent-panel-command-reply">
          <strong>{employee.employee_code}:</strong> {reply}
        </div>
      ) : null}
    </section>
  );
}
