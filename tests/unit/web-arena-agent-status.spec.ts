import type { SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import { describe, expect, it } from "vitest";
import {
  assignableTickets,
  currentTicketFor,
  deriveAgentStatus,
  openTicketsFor,
  truncate,
  workingEmployeeIds,
} from "../../apps/web-arena/src/scene3d/agentStatus.js";
import { planPlacements } from "../../apps/web-arena/src/scene3d/avatarMotion.js";
import {
  WAR_ROOM_CENTER,
  deskPosition,
  warRoomPosition,
} from "../../apps/web-arena/src/scene3d/layout.js";

const NOW = "2026-11-14T00:00:00.000Z";

function employee(overrides: Partial<SessionEmployee> = {}): SessionEmployee {
  return {
    id: "emp-1",
    session_fingerprint: "fp-1",
    role_template_id: "role-1",
    employee_code: "CUR-BE-01",
    slug: "cur-be-01",
    display_name: "Backend Bot",
    department: "backend",
    job_title: "Backend Engineer",
    transport_type: "mcp_bridge",
    capabilities: ["propose"],
    desk_slot_id: "desk-1",
    spatial_zone: "at_desk",
    avatar_pose: "idle",
    connection_status: "online",
    context_fill_pct: 0,
    session_cost_usd: 0,
    max_session_budget_usd: 5,
    last_heartbeat_at: NOW,
    ...overrides,
  } as SessionEmployee;
}

function ticket(overrides: Partial<TaskTicket> = {}): TaskTicket {
  return {
    id: "T-1",
    title: "Fix login",
    description_markdown: "",
    acceptance_criteria: [],
    depends_on_tickets: [],
    kanban_column: "backlog",
    priority: "p2_normal",
    assignee_session_id: null,
    reviewer_session_ids: [],
    base_branch: "main",
    retry_count: 0,
    max_retries: 2,
    failure_notes: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("deriveAgentStatus", () => {
  it("flags an agent with a pending permission as needing approval, even while typing", () => {
    const status = deriveAgentStatus(employee({ avatar_pose: "typing_code" }), new Set(["emp-1"]));
    expect(status.activity).toBe("needs_approval");
  });

  it("treats lounge or offline sessions as offline", () => {
    expect(
      deriveAgentStatus(employee({ spatial_zone: "lounge_offline" }), new Set()).activity,
    ).toBe("offline");
    expect(deriveAgentStatus(employee({ connection_status: "offline" }), new Set()).activity).toBe(
      "offline",
    );
  });

  it("reports meeting when walking to or seated at the war room", () => {
    const status = deriveAgentStatus(employee({ spatial_zone: "walking_to_war_room" }), new Set());
    expect(status.activity).toBe("meeting");
  });

  it("reports working for busy poses or an active ticket, idle otherwise", () => {
    expect(deriveAgentStatus(employee({ avatar_pose: "running_tests" }), new Set()).activity).toBe(
      "working",
    );
    expect(deriveAgentStatus(employee({ active_ticket_id: "T-9" }), new Set()).activity).toBe(
      "working",
    );
    expect(deriveAgentStatus(employee(), new Set()).activity).toBe("idle");
  });

  it("counts an agent owning an in-progress ticket as working even while idle", () => {
    const working = workingEmployeeIds([
      ticket({ id: "T-7", assignee_session_id: "emp-1", kanban_column: "in_progress" }),
      ticket({ id: "T-8", assignee_session_id: "emp-2", kanban_column: "backlog" }),
    ]);
    expect([...working]).toEqual(["emp-1"]);
    expect(deriveAgentStatus(employee(), new Set(), working).activity).toBe("working");
  });
});

describe("ticket helpers", () => {
  const tickets = [
    ticket({ id: "T-1", assignee_session_id: "emp-1", kanban_column: "assigned" }),
    ticket({ id: "T-2", assignee_session_id: "emp-1", kanban_column: "in_progress" }),
    ticket({ id: "T-3", assignee_session_id: "emp-1", kanban_column: "done" }),
    ticket({ id: "T-4", assignee_session_id: null, kanban_column: "backlog" }),
    ticket({ id: "T-5", assignee_session_id: null, kanban_column: "done" }),
  ];

  it("orders open tickets with in-progress work first and hides done ones", () => {
    expect(openTicketsFor("emp-1", tickets).map((t) => t.id)).toEqual(["T-2", "T-1"]);
  });

  it("prefers the explicit active ticket over the queue", () => {
    expect(currentTicketFor(employee({ active_ticket_id: "T-1" }), tickets)?.id).toBe("T-1");
    expect(currentTicketFor(employee(), tickets)?.id).toBe("T-2");
    expect(currentTicketFor(employee({ id: "emp-x" }), tickets)).toBeNull();
  });

  it("only offers unowned, unfinished tickets for assignment", () => {
    expect(assignableTickets(tickets).map((t) => t.id)).toEqual(["T-4"]);
  });

  it("truncates long text with an ellipsis", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a very long ticket title", 10)).toBe("a very lo…");
  });
});

describe("office layout", () => {
  it("gives every desk slot a distinct spot", () => {
    const spots = Array.from({ length: 12 }, (_, i) => deskPosition(i));
    const keys = new Set(spots.map((p) => `${p.x.toFixed(2)}:${p.z.toFixed(2)}`));
    expect(keys.size).toBe(12);
  });

  it("seats meeting participants around the war-room table", () => {
    const seat = warRoomPosition(0, 3);
    const radius = Math.hypot(seat.x - WAR_ROOM_CENTER.x, seat.z - WAR_ROOM_CENTER.z);
    expect(radius).toBeCloseTo(2.15, 5);
  });

  it("routes meeting agents to the table and others to their desks", () => {
    const desk = { x: -8.3, z: -2.4 };
    const placements = planPlacements(
      [
        employee({ id: "a" }),
        employee({ id: "b", spatial_zone: "at_war_room_table" }),
        employee({ id: "c", spatial_zone: "lounge_offline" }),
      ],
      () => desk,
    );
    expect(placements.get("a")?.target).toEqual(desk);
    expect(placements.get("b")?.target).toEqual(warRoomPosition(0, 1));
    expect(placements.get("c")?.target).not.toEqual(desk);
  });
});
