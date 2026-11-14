import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIKeyAdapter } from "@factory-arena/adapters";
import { BudgetExceededError } from "@factory-arena/core";
import { createHubApp } from "@factory-arena/hub-server";
import { describe, expect, it } from "vitest";

describe("US3 & US4 Integration: 4-Stage Sealed Council, >=50% Token Slicing, Budget Guard & Steer (T033)", () => {
  it("enforces SQL-level Round-1 sealed isolation, Proposal A..C anonymization, >=50% Round-3 token savings, and budget hard-stop", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us3-int-"));
    const hub = createHubApp({ stateDir: dir });

    try {
      const a1 = hub.core.roster.registerOrRebindSession({
        employee_code: "MSW-LEAD",
        display_name: "MSW Lead",
        department: "leadership",
        job_title: "Moderator",
        transport_type: "mcp_bridge",
        model_identifier: "secret-model-alpha",
        max_session_budget_usd: 1.0,
      });
      const a2 = hub.core.roster.registerOrRebindSession({
        employee_code: "IDE-ARCH",
        display_name: "VSCode Architect",
        department: "architecture",
        job_title: "Architect",
        transport_type: "acp_editor",
        model_identifier: "secret-model-beta",
      });
      const a3 = hub.core.roster.registerOrRebindSession({
        employee_code: "API-SEC",
        display_name: "Security Critic",
        department: "security_qa",
        job_title: "Security Auditor",
        transport_type: "api_key",
        model_identifier: "secret-model-gamma",
      });

      const epicTicket = hub.core.kanban.createTicket({
        title: "Epic: Zero-Collision Workspace Isolation",
        priority: "p0_critical",
        assignee_session_id: a1.id,
      });

      const { room, round1 } = hub.core.council.createRoom({
        title: "Distributed Session Lock Design",
        problemStatement: "Design zero-collision workspace isolation across 5 coding agents.",
        linkedTicketId: epicTicket.id,
        protocolMode: "council",
        participantIds: [a1.id, a2.id, a3.id],
        moderatorId: a1.id,
      });

      // All 3 employees walked to the War Room table
      expect(hub.core.roster.getEmployeeById(a1.id)?.spatial_zone).toBe("at_war_room_table");

      // Agent 1 submits first while Round 1 is SEALED
      const longBody1 = `# Architecture Plan Alpha\n\n${"Detailed technical specification paragraph with benchmarks and edge cases. ".repeat(80)}`;
      const sub1 = hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: a1.id,
        summary: "Use Git worktrees per ticket plus SQLite WAL file leases.",
        contentMarkdown: longBody1,
        citations: [
          { path: "packages/core/src/workspace/git-worktree-manager.ts", line_start: 15 },
        ],
      });
      expect(sub1.unsealedForCritique).toBe(false);

      // CRITICAL CHECK (SC-002): Agent 2 polling during sealed Round 1 MUST see 0 peer proposals
      const pollByA2 = hub.core.council.pollAssignment(room.id, a2.id);
      expect(pollByA2.round.visibility_state).toBe("sealed");
      expect(pollByA2.visible_proposals).toHaveLength(0);
      expect(
        hub.core.ledger
          .readEvents(room.id, a2.id)
          .some((e) => e.event_type === "proposal.submitted"),
      ).toBe(false);

      // Agent 2 and Agent 3 submit -> Round 1 automatically unseals & anonymizes
      hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: a2.id,
        summary: "Use advisory glob locks with 10s heartbeats.",
        contentMarkdown: `# Architecture Plan Beta\n\n${"Detailed lock hierarchy analysis and recovery protocol description. ".repeat(80)}`,
      });
      const sub3 = hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: a3.id,
        summary: "Use container namespaces plus read-only mounts.",
        contentMarkdown: `# Architecture Plan Gamma\n\n${"Security boundary analysis and container isolation tradeoffs. ".repeat(80)}`,
      });
      expect(sub3.unsealedForCritique).toBe(true);

      const unsealed = hub.core.council.pollAssignment(room.id, a2.id);
      expect(unsealed.round.visibility_state).toBe("anonymized");
      expect(unsealed.visible_proposals.map((p) => p.anonymous_alias)).toEqual([
        "Proposal A",
        "Proposal B",
        "Proposal C",
      ]);
      const serialized = JSON.stringify(unsealed.visible_proposals);
      expect(serialized).not.toContain("secret-model-alpha");
      expect(serialized).not.toContain("MSW-LEAD");

      // Cross-critique (pick an alias not authored by a2)
      const targetForA2 = unsealed.visible_proposals.find(
        (p) => !p.summary.includes("advisory glob"),
      );
      expect(targetForA2).toBeDefined();
      if (!targetForA2) {
        throw new Error("Expected at least one peer proposal for a2 critique");
      }
      hub.core.council.submitCritique({
        roomId: room.id,
        roundId: round1.id,
        reviewerSessionId: a2.id,
        targetAnonymousAlias: targetForA2.anonymous_alias,
        rubricScores: { correctness: 9, security: 9, maintainability: 8, feasibility: 9 },
        findings: [
          {
            severity: "high",
            category: "edge_case",
            claim: "Must prune stale worktrees after crash",
            evidence_ref: "packages/core/src/workspace/git-worktree-manager.ts:55",
          },
        ],
      });

      // Ranked votes
      hub.core.council.castVote({
        roomId: room.id,
        roundId: round1.id,
        voterSessionId: a1.id,
        rankedAliases: ["Proposal A", "Proposal B", "Proposal C"],
        confidence: 0.9,
      });
      hub.core.council.castVote({
        roomId: room.id,
        roundId: round1.id,
        voterSessionId: a2.id,
        rankedAliases: ["Proposal A", "Proposal C", "Proposal B"],
        confidence: 0.85,
      });

      // Verify >= 50% token savings from Round 3+ via PromptContextSlicer & Blackboard offloading (SC-004)
      const round3Slice = hub.core.council.buildContextForNextRound(room.id, 3);
      expect(round3Slice.reductionRatio).toBeGreaterThanOrEqual(0.5);

      // Publish DecisionRecord + DissentLog -> moves to awaiting_human_gate
      const decision = hub.core.council.publishDecision({
        roomId: room.id,
        moderatorId: a1.id,
        winningAlias: "Proposal A",
        finalPlanMarkdown: "Adopt Git worktrees + FileLease lock hybrid.",
        adoptedAmendments: ["Add automatic git worktree prune on startup"],
        dissentLog: [
          {
            issue: "Disk usage overhead on large monorepos",
            raised_by_alias: "Proposal C",
            revisit_trigger: "When worktree pool exceeds 5GB",
          },
        ],
      });
      expect(decision.dissent_log).toHaveLength(1);
      expect(hub.core.council.getRoom(room.id)?.status).toBe("awaiting_human_gate");

      // Director approves at Human Gate -> employees walk back to desks & DecisionRecord auto-decomposes into child beads (T047)
      const approvedRoom = hub.core.council.steerOrResolveGate({
        roomId: room.id,
        action: "approve_decision",
        approvedBy: "Director Nam",
      });
      expect(approvedRoom.status).toBe("executing");
      expect(hub.core.roster.getEmployeeById(a1.id)?.spatial_zone).toBe("at_desk");

      const childBeads = hub.core.kanban.listTickets().filter((t) => t.decision_id === decision.id);
      expect(childBeads.length).toBeGreaterThanOrEqual(2);
      expect(childBeads.every((t) => t.parent_ticket_id === epicTicket.id)).toBe(true);

      // Verify US4 PayrollBudgetGuard 100% hard-stop
      const budgetOutcome = hub.core.budget.recordSpend({
        sessionEmployeeId: a1.id,
        roomId: room.id,
        promptTokens: 5000,
        completionTokens: 2000,
        costUsd: 1.05,
      });
      expect(budgetOutcome.status).toBe("hard_stopped_100pct");
      expect(hub.core.roster.getEmployeeById(a1.id)?.avatar_pose).toBe("budget_paused");
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts sealed SSE events without viewerParticipantId, enforces pre-flight budget hard-stop, and guards Council transitions & tie-break", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us3-regressions-"));
    const hub = createHubApp({ stateDir: dir });

    try {
      const cred = hub.core.vault.addCredential({
        label: "Test Budget Key",
        provider_kind: "openai_compatible",
        raw_secret: "sk-test-budget-hardstop-secret-123456",
        max_cost_usd: 0.5,
      });

      const e1 = hub.core.roster.registerOrRebindSession({
        employee_code: "API-W1",
        display_name: "API Worker 1",
        department: "backend",
        job_title: "Backend Architect",
        transport_type: "api_key",
        credential_id: cred.id,
        max_session_budget_usd: 0.5,
      });
      const e2 = hub.core.roster.registerOrRebindSession({
        employee_code: "IDE-W2",
        display_name: "IDE Worker 2",
        department: "architecture",
        job_title: "Systems Architect",
        transport_type: "mcp_bridge",
      });
      const e3 = hub.core.roster.registerOrRebindSession({
        employee_code: "IDE-W3",
        display_name: "IDE Worker 3",
        department: "security_qa",
        job_title: "Security Reviewer",
        transport_type: "mcp_bridge",
      });

      const { room, round1 } = hub.core.council.createRoom({
        title: "Sealed SSE & Quorum Verification",
        problemStatement:
          "Ensure zero sealed Round-1 leakage on SSE and proper quorum transitions.",
        protocolMode: "council",
        participantIds: [e1.id, e2.id, e3.id],
        moderatorId: e1.id,
        config: { max_rounds: 1, quorum_ratio: 0.67 },
      });

      hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: e1.id,
        summary: "Confidential sealed proposal summary",
        contentMarkdown: "TOP_SECRET_ROUND_1_PROPOSAL_BODY",
      });

      // 1. SSE /events WITHOUT viewerParticipantId MUST NOT leak sealed Round-1 proposal
      const sseSealedRes = await hub.app.request(`/api/v1/rooms/${room.id}/events`);
      expect(sseSealedRes.status).toBe(200);
      const sseSealedBody = await sseSealedRes.text();
      expect(sseSealedBody).not.toContain("TOP_SECRET_ROUND_1_PROPOSAL_BODY");
      expect(sseSealedBody).not.toContain("proposal.submitted");

      // Author passing viewerParticipantId=e1.id CAN read their own sealed proposal
      const sseAuthorRes = await hub.app.request(
        `/api/v1/rooms/${room.id}/events?viewerParticipantId=${e1.id}`,
      );
      expect(await sseAuthorRes.text()).toContain("TOP_SECRET_ROUND_1_PROPOSAL_BODY");

      // Complete Round 1 -> unseals to critiquing
      hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: e2.id,
        summary: "Second proposal",
        contentMarkdown: "- Implement lock manager\n- Add retry tests",
      });
      hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: e3.id,
        summary: "Third proposal",
        contentMarkdown: "- Implement worktree pool\n- Add cleanup hook",
      });

      // 2. Critique quorum: 1st critique of 3 participants (quorum=2) keeps room in 'critiquing'
      const peersForE2 = hub.core.council.getVisibleSubmissionsForViewer(round1.id, e2.id);
      const peerTargetForE2 = peersForE2.find((p) => p.summary !== "Second proposal");
      if (!peerTargetForE2) throw new Error("Missing peer target for e2");

      hub.core.council.submitCritique({
        roomId: room.id,
        roundId: round1.id,
        reviewerSessionId: e2.id,
        targetAnonymousAlias: peerTargetForE2.anonymous_alias,
        rubricScores: { correctness: 8, security: 8, maintainability: 8, feasibility: 8 },
        findings: [],
      });
      expect(hub.core.council.getRoom(room.id)?.status).toBe("critiquing");

      // 2nd distinct reviewer reaches quorum (2 >= ceil(3 * 0.67)) -> transitions to 'voting'
      const peerTargetForE3 = peersForE2.find((p) => p.summary !== "Third proposal");
      if (!peerTargetForE3) throw new Error("Missing peer target for e3");
      hub.core.council.submitCritique({
        roomId: room.id,
        roundId: round1.id,
        reviewerSessionId: e3.id,
        targetAnonymousAlias: peerTargetForE3.anonymous_alias,
        rubricScores: { correctness: 9, security: 9, maintainability: 9, feasibility: 9 },
        findings: [],
      });
      expect(hub.core.council.getRoom(room.id)?.status).toBe("voting");

      // SSE without viewerParticipantId must also anonymize actor_session_employee_id on anonymized_peers events
      const sseAnonText = await (await hub.app.request(`/api/v1/rooms/${room.id}/events`)).text();
      expect(sseAnonText).not.toContain(`"actor_session_employee_id":"${e2.id}"`);

      const decision = hub.core.council.publishDecision({
        roomId: room.id,
        moderatorId: e1.id,
        winningAlias: "Proposal A",
        finalPlanMarkdown: "- Initial plan item",
        dissentLog: [],
      });
      expect(decision.winning_alias).toBe("Proposal A");

      // 3. reject_and_reopen at max_rounds=1 must return HTTP 409 and NOT wedge room in 'diverging'
      const reopenBlockedRes = await hub.app.request(`/api/v1/rooms/${room.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject_and_reopen" }),
      });
      expect(reopenBlockedRes.status).toBe(409);
      expect(hub.core.council.getRoom(room.id)?.status).toBe("awaiting_human_gate");

      // Director tie-break override via selected_submission_id sets resolution_method = 'human_override'
      const overrideRes = await hub.app.request(`/api/v1/rooms/${room.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_decision",
          selected_submission_id: "Proposal B",
          approved_by: "Director Override",
        }),
      });
      expect(overrideRes.status).toBe(200);
      const overriddenDecision = hub.core.council.getLatestDecision(room.id);
      expect(overriddenDecision?.winning_alias).toBe("Proposal B");
      expect(overriddenDecision?.resolution_method).toBe("human_override");

      // 4. Pre-flight PayrollBudgetGuard hard-stop blocks outbound fetch AND /command HTTP route (402)
      hub.core.budget.recordSpend({
        sessionEmployeeId: e1.id,
        promptTokens: 1000,
        completionTokens: 1000,
        costUsd: 0.55,
      });
      expect(hub.core.roster.getEmployeeById(e1.id)?.avatar_pose).toBe("budget_paused");

      let outboundCalls = 0;
      const guardedAdapter = new APIKeyAdapter(hub.core.vault, hub.core.budget, async () => {
        outboundCalls += 1;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Resumed after top-up" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      const pausedEmp = hub.core.roster.getEmployeeById(e1.id);
      if (!pausedEmp) throw new Error("Missing paused employee");

      await expect(
        guardedAdapter.sendAssignment(pausedEmp, {
          roomId: "office-global",
          prompt: "Should fail",
        }),
      ).rejects.toBeInstanceOf(BudgetExceededError);
      expect(outboundCalls).toBe(0);

      const cmdBlockedRes = await hub.app.request(`/api/v1/participants/${e1.id}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Attempt command while budget_paused" }),
      });
      expect(cmdBlockedRes.status).toBe(402);
      expect(hub.core.roster.getEmployeeById(e1.id)?.avatar_pose).toBe("budget_paused");

      // Approving budget_topup permission increases budget cap and allows execution to resume
      const pendingTopup = hub.core.roster
        .listPendingPermissions()
        .find((p) => p.session_employee_id === e1.id && p.request_kind === "budget_topup");
      expect(pendingTopup).toBeDefined();
      if (!pendingTopup) throw new Error("Missing budget_topup permission");

      hub.core.roster.resolvePermission({
        permissionId: pendingTopup.id,
        decision: "allowed",
      });
      const resumedEmp = hub.core.roster.getEmployeeById(e1.id);
      if (!resumedEmp) throw new Error("Missing resumed employee");
      expect(resumedEmp.max_session_budget_usd).toBeGreaterThan(0.55);

      // Update credential cap check: with credential max_cost_usd=0.5, credential cap still guards if lower!
      const unlimitedCred = hub.core.vault.addCredential({
        label: "Topped Up Key",
        provider_kind: "openai_compatible",
        raw_secret: "sk-test-topped-up-secret-999999",
        max_cost_usd: 10,
      });
      hub.core.db
        .prepare("UPDATE session_employees SET credential_id = ? WHERE id = ?")
        .run(unlimitedCred.id, resumedEmp.id);
      const refreshedEmp = hub.core.roster.getEmployeeById(e1.id);
      if (!refreshedEmp) throw new Error("Missing refreshed employee");

      const turnOut = await guardedAdapter.sendAssignment(refreshedEmp, {
        roomId: "office-global",
        prompt: "Proceed after budget top-up",
      });
      expect(outboundCalls).toBe(1);
      expect(turnOut.contentMarkdown).toBe("Resumed after top-up");
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
