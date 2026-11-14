import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArenaClientError,
  BudgetExceededError,
  assertAllowedCliCommand,
} from "@factory-arena/core";
import { createHubApp, resolveHubApiToken } from "@factory-arena/hub-server";
import { MAX_DELIBERATION_ROUNDS, type RegisterEmployeeInput } from "@factory-arena/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { parseCritiqueScore } from "../../apps/hub-server/src/routes/council-orchestration.js";

type Hub = ReturnType<typeof createHubApp>;

const openHubs: Hub[] = [];
const openDirs: string[] = [];

function makeHub(options: { apiToken?: string } = {}): Hub {
  const dir = mkdtempSync(join(tmpdir(), "arena-hardening-"));
  openDirs.push(dir);
  const hub = createHubApp({ stateDir: dir, ...options });
  openHubs.push(hub);
  return hub;
}

afterEach(() => {
  for (const hub of openHubs.splice(0)) hub.core.close();
  for (const dir of openDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hire(hub: Hub, code: string, extra: Partial<RegisterEmployeeInput> = {}) {
  return hub.core.roster.registerOrRebindSession({
    employee_code: code,
    display_name: code,
    department: "backend",
    job_title: "Engineer",
    transport_type: "api_key",
    ...extra,
  });
}

/** HTTP-style status of an ArenaClientError thrown by `fn` (0 = no error, -1 = other error). */
function statusOf(fn: () => unknown): number {
  try {
    fn();
    return 0;
  } catch (error: unknown) {
    return error instanceof ArenaClientError ? error.status : -1;
  }
}

/** Three-member council with all proposals in and a decision awaiting the human gate. */
function councilAwaitingGate(hub: Hub) {
  const members = ["CNL-A", "CNL-B", "CNL-C"].map((code) => hire(hub, code));
  const [moderator] = members;
  if (!moderator) throw new Error("no members hired");
  const { room, round1 } = hub.core.council.createRoom({
    title: "Choose isolation strategy",
    problemStatement: "Pick between worktrees and file leases",
    protocolMode: "council",
    participantIds: members.map((m) => m.id),
    moderatorId: moderator.id,
  });
  members.forEach((emp, i) => {
    hub.core.council.submitProposal({
      roomId: room.id,
      roundId: round1.id,
      sessionEmployeeId: emp.id,
      summary: `Plan ${i}`,
      contentMarkdown: `- Step ${i}.1 build\n- Step ${i}.2 verify`,
    });
  });
  const decision = hub.core.council.publishDecision({
    roomId: room.id,
    moderatorId: moderator.id,
    winningAlias: "Proposal A",
    finalPlanMarkdown: "- Build alpha module\n- Test alpha module",
    dissentLog: [],
  });
  return { room, decision, members };
}

describe("Review hardening: CLI spawn policy (#2)", () => {
  it("allows known coding-agent CLIs and refuses shells, inline code and spoofed paths", () => {
    expect(() => assertAllowedCliCommand(["claude", "-p", "hello"])).not.toThrow();
    expect(statusOf(() => assertAllowedCliCommand(["bash", "-lc", "id"]))).toBe(403);
    expect(statusOf(() => assertAllowedCliCommand(["cmd.exe", "/c", "dir"]))).toBe(403);
    expect(statusOf(() => assertAllowedCliCommand(["node", "-e", "1"], ["node"]))).toBe(403);
    expect(() => assertAllowedCliCommand(["node", "agent.js"], ["node"])).not.toThrow();
    expect(statusOf(() => assertAllowedCliCommand(["/opt/evil/claude"]))).toBe(403);
    expect(() =>
      assertAllowedCliCommand(["/opt/tools/claude"], ["/opt/tools/claude"]),
    ).not.toThrow();
  });
});

describe("Review hardening: session token & origins (#3, #7)", () => {
  it("never lets a blank token disable auth on a non-loopback bind", () => {
    expect(resolveHubApiToken("0.0.0.0", undefined, "")).toMatch(/^[0-9a-f]{48}$/);
    expect(resolveHubApiToken("0.0.0.0", "  ", "   ")).toMatch(/^[0-9a-f]{48}$/);
    expect(resolveHubApiToken("127.0.0.1", undefined, "")).toBeUndefined();
    expect(resolveHubApiToken("0.0.0.0", undefined, " env-token ")).toBe("env-token");
    expect(resolveHubApiToken("0.0.0.0", "explicit", "env-token")).toBe("explicit");
  });

  it("accepts the hub's own LAN origin but still rejects other origins", async () => {
    const hub = makeHub({ apiToken: "lan-token" });
    const url = "http://192.168.1.5:4747/api/v1/participants";
    const sameOrigin = await hub.app.request(url, {
      headers: { Origin: "http://192.168.1.5:4747", "X-Arena-Session-Token": "lan-token" },
    });
    expect(sameOrigin.status).toBe(200);
    const foreign = await hub.app.request(url, {
      headers: { Origin: "http://192.168.1.9:4747", "X-Arena-Session-Token": "lan-token" },
    });
    expect(foreign.status).toBe(403);
  });
});

describe("Review hardening: budget & permissions (#5, #6)", () => {
  it("applies a budget top-up exactly once and only for the director", () => {
    const hub = makeHub();
    const emp = hire(hub, "BUD-01", { max_session_budget_usd: 1 });
    hub.core.budget.recordSpend({
      sessionEmployeeId: emp.id,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 1,
    });
    const pendingTopups = () =>
      hub.core.roster
        .listPendingPermissions()
        .filter((p) => p.session_employee_id === emp.id && p.request_kind === "budget_topup");
    expect(pendingTopups()).toHaveLength(1);

    // Hitting the paused employee again must not stack a second top-up request.
    expect(() => hub.core.budget.assertWithinBudget({ sessionEmployeeId: emp.id })).toThrow(
      BudgetExceededError,
    );
    expect(pendingTopups()).toHaveLength(1);
    const permissionId = pendingTopups()[0]?.id ?? "";

    const resolve = (resolvedBy: "director_ui" | "lead_agent") =>
      hub.core.roster.resolvePermission({ permissionId, decision: "allowed", resolvedBy });
    expect(statusOf(() => resolve("lead_agent"))).toBe(403);
    expect(statusOf(() => resolve("director_ui"))).toBe(0);
    const capAfterTopup = hub.core.roster.getEmployeeById(emp.id)?.max_session_budget_usd;
    expect(statusOf(() => resolve("director_ui"))).toBe(409);
    expect(hub.core.roster.getEmployeeById(emp.id)?.max_session_budget_usd).toBe(capAfterTopup);

    // After the approved top-up the employee can work again.
    expect(() => hub.core.budget.assertWithinBudget({ sessionEmployeeId: emp.id })).not.toThrow();
  });

  it("enforces a credential cap on the credential's total spend without stranding employees", () => {
    const hub = makeHub();
    const a = hire(hub, "CRD-A", { credential_id: "cred_shared" });
    const b = hire(hub, "CRD-B", { credential_id: "cred_shared" });
    for (const emp of [a, b]) {
      hub.core.budget.recordSpend({
        sessionEmployeeId: emp.id,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0.6,
      });
    }

    let caught: unknown;
    try {
      hub.core.budget.assertWithinBudget({ sessionEmployeeId: b.id, credentialMaxCostUsd: 1 });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect((caught as BudgetExceededError).details.scope).toBe("credential");
    expect(hub.core.roster.getEmployeeById(b.id)?.avatar_pose).not.toBe("budget_paused");
  });
});

describe("Review hardening: council gate (#1, #8)", () => {
  it("caps reopened rounds at the hard limit and heals rooms stored above it", () => {
    const hub = makeHub();
    const { room } = councilAwaitingGate(hub);
    const reopen = () =>
      hub.core.council.steerOrResolveGate({
        roomId: room.id,
        action: "reject_and_reopen",
        extendMaxRounds: true,
      });
    for (let n = 2; n <= MAX_DELIBERATION_ROUNDS; n++) reopen();
    expect(hub.core.council.listRounds(room.id)).toHaveLength(MAX_DELIBERATION_ROUNDS);
    expect(statusOf(reopen)).toBe(409);
    expect(hub.core.council.getRoom(room.id)?.config.max_rounds).toBe(MAX_DELIBERATION_ROUNDS);

    // A row written by an older build (max_rounds above the schema cap) must still be readable.
    hub.core.db
      .prepare(
        "UPDATE war_room_meetings SET config_json = json_set(config_json, '$.max_rounds', 11) WHERE id = ?",
      )
      .run(room.id);
    expect(hub.core.council.getRoom(room.id)?.config.max_rounds).toBe(MAX_DELIBERATION_ROUNDS);
    expect(hub.core.council.listRooms()).toHaveLength(1);
  });

  it("refuses to approve a stale decision after the room was reopened", () => {
    const hub = makeHub();
    const { room } = councilAwaitingGate(hub);
    hub.core.council.steerOrResolveGate({ roomId: room.id, action: "reject_and_reopen" });
    expect(
      statusOf(() =>
        hub.core.council.steerOrResolveGate({ roomId: room.id, action: "approve_decision" }),
      ),
    ).toBe(409);
  });

  it("re-plans beads when the director overrides the winner after decomposition", () => {
    const hub = makeHub();
    const { room, decision } = councilAwaitingGate(hub);
    hub.core.council.steerOrResolveGate({ roomId: room.id, action: "approve_decision" });
    const beadsFor = (decisionId: string) =>
      hub.core.kanban.listTickets().filter((t) => t.decision_id === decisionId);
    expect(beadsFor(decision.id).length).toBeGreaterThan(0);

    hub.core.council.steerOrResolveGate({
      roomId: room.id,
      action: "approve_decision",
      selectedSubmissionId: "Proposal B",
    });
    const latest = hub.core.council.getLatestDecision(room.id);
    expect(latest?.id).not.toBe(decision.id);
    expect(latest?.winning_alias).toBe("Proposal B");
    expect(beadsFor(latest?.id ?? "").length).toBeGreaterThan(0);
    for (const bead of beadsFor(decision.id)) {
      expect(bead.kanban_column).toBe("blocked");
      expect(bead.assignee_session_id ?? null).toBeNull();
      expect(bead.failure_notes.some((note) => note.includes("Superseded"))).toBe(true);
    }
  });
});

describe("Review hardening: summon-council orchestration (#4, #9)", () => {
  const summon = (hub: Hub, participantIds: string[]) =>
    hub.app.request("/api/v1/rooms/summon-council", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Pick a cache strategy",
        problem_statement: "Choose between Redis and in-process LRU",
        participant_ids: participantIds,
      }),
    });

  it("rejects unknown participants before creating any room or ticket", async () => {
    const hub = makeHub();
    const [first] = ["SC-A", "SC-B"].map((code) => hire(hub, code));
    const res = await summon(hub, [first?.id ?? "", "emp_ghost"]);
    expect(res.status).toBe(400);
    expect(hub.core.council.listRooms()).toHaveLength(0);
    expect(hub.core.kanban.listTickets()).toHaveLength(0);
  });

  it("has every member critique every proposal except their own", async () => {
    const hub = makeHub();
    const members = ["SC-A", "SC-B", "SC-C"].map((code) => hire(hub, code));
    const res = await summon(
      hub,
      members.map((m) => m.id),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { room: { id: string } };
    const critiques = hub.core.council.listCritiques(body.room.id);
    expect(critiques).toHaveLength(members.length * (members.length - 1));
  });

  it("reads reviewer scores from `SCORE: n` replies", () => {
    expect(parseCritiqueScore("SCORE: 9\nSolid plan")).toBe(9);
    expect(parseCritiqueScore("score=42")).toBe(10);
    expect(parseCritiqueScore("no number here")).toBeNull();
  });
});
