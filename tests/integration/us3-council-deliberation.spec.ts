import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        max_session_budget_usd: 1.0
      });
      const a2 = hub.core.roster.registerOrRebindSession({
        employee_code: "IDE-ARCH",
        display_name: "VSCode Architect",
        department: "architecture",
        job_title: "Architect",
        transport_type: "acp_editor",
        model_identifier: "secret-model-beta"
      });
      const a3 = hub.core.roster.registerOrRebindSession({
        employee_code: "API-SEC",
        display_name: "Security Critic",
        department: "security_qa",
        job_title: "Security Auditor",
        transport_type: "api_key",
        model_identifier: "secret-model-gamma"
      });

      const { room, round1 } = hub.core.council.createRoom({
        title: "Distributed Session Lock Design",
        problemStatement: "Design zero-collision workspace isolation across 5 coding agents.",
        protocolMode: "council",
        participantIds: [a1.id, a2.id, a3.id],
        moderatorId: a1.id
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
        citations: [{ path: "packages/core/src/workspace/git-worktree-manager.ts", line_start: 15 }]
      });
      expect(sub1.unsealedForCritique).toBe(false);

      // CRITICAL CHECK (SC-002): Agent 2 polling during sealed Round 1 MUST see 0 peer proposals
      const pollByA2 = hub.core.council.pollAssignment(room.id, a2.id);
      expect(pollByA2.round.visibility_state).toBe("sealed");
      expect(pollByA2.visible_proposals).toHaveLength(0);
      expect(hub.core.ledger.readEvents(room.id, a2.id).some((e) => e.event_type === "proposal.submitted")).toBe(false);

      // Agent 2 and Agent 3 submit -> Round 1 automatically unseals & anonymizes
      hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: a2.id,
        summary: "Use advisory glob locks with 10s heartbeats.",
        contentMarkdown: `# Architecture Plan Beta\n\n${"Detailed lock hierarchy analysis and recovery protocol description. ".repeat(80)}`
      });
      const sub3 = hub.core.council.submitProposal({
        roomId: room.id,
        roundId: round1.id,
        sessionEmployeeId: a3.id,
        summary: "Use container namespaces plus read-only mounts.",
        contentMarkdown: `# Architecture Plan Gamma\n\n${"Security boundary analysis and container isolation tradeoffs. ".repeat(80)}`
      });
      expect(sub3.unsealedForCritique).toBe(true);

      const unsealed = hub.core.council.pollAssignment(room.id, a2.id);
      expect(unsealed.round.visibility_state).toBe("anonymized");
      expect(unsealed.visible_proposals.map((p) => p.anonymous_alias)).toEqual([
        "Proposal A",
        "Proposal B",
        "Proposal C"
      ]);
      const serialized = JSON.stringify(unsealed.visible_proposals);
      expect(serialized).not.toContain("secret-model-alpha");
      expect(serialized).not.toContain("MSW-LEAD");

      // Cross-critique (pick an alias not authored by a2)
      const targetForA2 = unsealed.visible_proposals.find((p) => !p.summary.includes("advisory glob"))!;
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
            evidence_ref: "packages/core/src/workspace/git-worktree-manager.ts:55"
          }
        ]
      });

      // Ranked votes
      hub.core.council.castVote({
        roomId: room.id,
        roundId: round1.id,
        voterSessionId: a1.id,
        rankedAliases: ["Proposal A", "Proposal B", "Proposal C"],
        confidence: 0.9
      });
      hub.core.council.castVote({
        roomId: room.id,
        roundId: round1.id,
        voterSessionId: a2.id,
        rankedAliases: ["Proposal A", "Proposal C", "Proposal B"],
        confidence: 0.85
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
            revisit_trigger: "When worktree pool exceeds 5GB"
          }
        ]
      });
      expect(decision.dissent_log).toHaveLength(1);
      expect(hub.core.council.getRoom(room.id)?.status).toBe("awaiting_human_gate");

      // Director approves at Human Gate -> employees walk back to desks for execution
      const approvedRoom = hub.core.council.steerOrResolveGate({
        roomId: room.id,
        action: "approve_decision",
        approvedBy: "Director Nam"
      });
      expect(approvedRoom.status).toBe("executing");
      expect(hub.core.roster.getEmployeeById(a1.id)?.spatial_zone).toBe("at_desk");

      // Verify US4 PayrollBudgetGuard 100% hard-stop
      const budgetOutcome = hub.core.budget.recordSpend({
        sessionEmployeeId: a1.id,
        roomId: room.id,
        promptTokens: 5000,
        completionTokens: 2000,
        costUsd: 1.05
      });
      expect(budgetOutcome.status).toBe("hard_stopped_100pct");
      expect(hub.core.roster.getEmployeeById(a1.id)?.avatar_pose).toBe("budget_paused");
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
