import type {
  KanbanColumn,
  PermissionRequest,
  SessionEmployee,
  TaskTicket,
  TicketPriority,
} from "@factory-arena/protocol";

export type AgentActivity =
  | "needs_approval"
  | "meeting"
  | "working"
  | "paused"
  | "offline"
  | "idle";

export interface AgentStatusInfo {
  activity: AgentActivity;
  label: string;
  emoji: string;
  /** CSS color used by HTML overlays. */
  css: string;
  /** Hex color used by the 3D status ring. */
  hex: number;
}

const STATUS_META: Record<AgentActivity, Omit<AgentStatusInfo, "activity">> = {
  needs_approval: { label: "Cần duyệt", emoji: "✋", css: "#f6b94c", hex: 0xf6b94c },
  meeting: { label: "Đang họp", emoji: "⚖️", css: "#9d8cf2", hex: 0x9d8cf2 },
  working: { label: "Đang làm", emoji: "💻", css: "#5fd3a6", hex: 0x5fd3a6 },
  paused: { label: "Tạm dừng", emoji: "⏸️", css: "#f08f8f", hex: 0xf08f8f },
  offline: { label: "Offline", emoji: "☕", css: "#9aa3b5", hex: 0x9aa3b5 },
  idle: { label: "Rảnh", emoji: "🌿", css: "#7fb8e6", hex: 0x7fb8e6 },
};

const WORKING_POSES = new Set<SessionEmployee["avatar_pose"]>([
  "typing_code",
  "reading_files",
  "running_tests",
  "speaking",
]);

export const POSE_LABELS: Record<SessionEmployee["avatar_pose"], string> = {
  idle: "Đang nghỉ",
  typing_code: "Đang viết code",
  reading_files: "Đang đọc file",
  running_tests: "Đang chạy test",
  speaking: "Đang phát biểu",
  hand_raised: "Đang giơ tay xin quyền",
  budget_paused: "Đã hết ngân sách phiên",
};

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  backlog: "Backlog",
  assigned: "Đã giao",
  in_progress: "Đang làm",
  in_war_room_debate: "Đang họp",
  in_review: "Review",
  director_gate: "Chờ duyệt",
  done: "Xong",
  blocked: "Bị chặn",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  p0_critical: "P0 · Khẩn",
  p1_high: "P1 · Cao",
  p2_normal: "P2 · Thường",
  p3_low: "P3 · Thấp",
};

export function isInMeeting(emp: Pick<SessionEmployee, "spatial_zone">): boolean {
  return emp.spatial_zone === "at_war_room_table" || emp.spatial_zone === "walking_to_war_room";
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * @param workingEmployeeIds employees that own an in-progress ticket; they count as
 *   working even before their session reports a busy pose.
 */
export function deriveAgentStatus(
  emp: SessionEmployee,
  pendingEmployeeIds: ReadonlySet<string>,
  workingEmployeeIds: ReadonlySet<string> = NO_IDS,
): AgentStatusInfo {
  return statusStyle(deriveActivity(emp, pendingEmployeeIds, workingEmployeeIds));
}

/** Visual style (label, emoji, colors) for a given activity. */
export function statusStyle(activity: AgentActivity): AgentStatusInfo {
  return { activity, ...STATUS_META[activity] };
}

function deriveActivity(
  emp: SessionEmployee,
  pendingIds: ReadonlySet<string>,
  workingIds: ReadonlySet<string>,
): AgentActivity {
  if (emp.avatar_pose === "hand_raised" || pendingIds.has(emp.id)) return "needs_approval";
  if (emp.connection_status === "offline" || emp.spatial_zone === "lounge_offline") {
    return "offline";
  }
  if (emp.avatar_pose === "budget_paused") return "paused";
  if (isInMeeting(emp)) return "meeting";
  if (
    WORKING_POSES.has(emp.avatar_pose) ||
    emp.connection_status === "busy" ||
    Boolean(emp.active_ticket_id) ||
    workingIds.has(emp.id)
  ) {
    return "working";
  }
  return "idle";
}

const ACTIVE_COLUMNS: readonly KanbanColumn[] = [
  "in_progress",
  "in_war_room_debate",
  "in_review",
  "director_gate",
  "blocked",
  "assigned",
];

/** Tickets assigned to the employee that are not finished, most active first. */
export function openTicketsFor(employeeId: string, tickets: readonly TaskTicket[]): TaskTicket[] {
  return tickets
    .filter((t) => t.assignee_session_id === employeeId && t.kanban_column !== "done")
    .sort((a, b) => columnRank(a.kanban_column) - columnRank(b.kanban_column));
}

function columnRank(column: KanbanColumn): number {
  const idx = ACTIVE_COLUMNS.indexOf(column);
  return idx === -1 ? ACTIVE_COLUMNS.length : idx;
}

/** The ticket the employee is working on right now (explicit active ticket wins). */
export function currentTicketFor(
  emp: SessionEmployee,
  tickets: readonly TaskTicket[],
): TaskTicket | null {
  if (emp.active_ticket_id) {
    const active = tickets.find((t) => t.id === emp.active_ticket_id);
    if (active) return active;
  }
  return openTicketsFor(emp.id, tickets)[0] ?? null;
}

/** Ids of employees that currently own an in-progress ticket. */
export function workingEmployeeIds(tickets: readonly TaskTicket[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tickets) {
    if (t.kanban_column === "in_progress" && t.assignee_session_id) ids.add(t.assignee_session_id);
  }
  return ids;
}

/** Tickets nobody owns yet that can be handed to an agent. */
export function assignableTickets(tickets: readonly TaskTicket[]): TaskTicket[] {
  return tickets.filter((t) => !t.assignee_session_id && t.kanban_column !== "done");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}
