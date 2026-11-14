import type { AnonymizedProposalView, ArenaCoreContainer } from "@factory-arena/core";
import { BudgetExceededError } from "@factory-arena/core";
import type { SessionEmployee } from "@factory-arena/protocol";
import type { CommandRoutesDeps } from "./commands.js";

export interface CouncilBrief {
  roomId: string;
  roundId: string;
  ticketId: string | null;
  title: string;
  problemStatement: string;
}

export type ProposalOutcome = "submitted" | "awaiting_live";

const NEUTRAL_SCORE = 7;
const MIN_SCORE = 1;
const MAX_SCORE = 10;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fallbackProposal(emp: SessionEmployee, brief: CouncilBrief, reason?: string) {
  const header = reason
    ? `Đề xuất dự phòng từ ${emp.job_title} (lỗi gọi agent: ${reason}):`
    : `### Đề xuất góc nhìn ${emp.department.toUpperCase()} (${emp.job_title})\nĐối với yêu cầu **"${brief.title}"**:`;
  return {
    contentMarkdown: `${header}\n- Triển khai thành phần cốt lõi đáp ứng: ${brief.problemStatement}\n- Cô lập thay đổi trên nhánh Git Worktree riêng và kiểm tra tự động trước khi merge`,
    summary: `[${emp.department}] Giải pháp cho "${brief.title.slice(0, 90)}"`,
  };
}

/**
 * Collect one participant's blind Round-1 proposal. Synchronous transports (API key, A2A) answer
 * inline; live editor/CLI sessions are notified and submit later via MCP. A failing remote agent
 * degrades to a fallback proposal instead of aborting the whole council.
 */
export async function collectProposal(
  deps: CommandRoutesDeps,
  emp: SessionEmployee,
  brief: CouncilBrief,
): Promise<ProposalOutcome> {
  const { core, apiKeyAdapter, a2aAdapter, mcpAdapter, acpAdapter, cliPtyAdapter } = deps;
  const assignment = {
    roomId: brief.roomId,
    roundId: brief.roundId,
    ticketId: brief.ticketId ?? undefined,
  };
  let proposal: { contentMarkdown: string; summary: string };

  if (emp.transport_type === "api_key" && emp.credential_id) {
    proposal = await askSynchronously(emp, brief, async () => {
      await apiKeyAdapter.connect(emp);
      return apiKeyAdapter.sendAssignment(emp, {
        ...assignment,
        prompt: `Bạn đang tham gia Vòng 1 (Blind Divergence) của Hội đồng Kiến trúc.\nChủ đề: ${brief.title}\nĐề bài chi tiết: ${brief.problemStatement}\nHãy đề xuất phương án kỹ thuật ngắn gọn, rõ ràng kèm các bước triển khai gạch đầu dòng (- Bước 1...).`,
      });
    });
  } else if (emp.transport_type === "a2a_remote" && emp.agent_card) {
    proposal = await askSynchronously(emp, brief, async () => {
      await a2aAdapter.connect(emp);
      return a2aAdapter.sendAssignment(emp, {
        ...assignment,
        prompt: `[Council Round 1 - Blind Divergence] ${brief.title}: ${brief.problemStatement}`,
      });
    });
  } else if (emp.transport_type === "mcp_bridge" && (await mcpAdapter.heartbeat(emp.id))) {
    await mcpAdapter.sendAssignment(emp, {
      ...assignment,
      prompt: `[Council Round 1] ${brief.title}: ${brief.problemStatement}. Call arena_submit_proposal for room_id="${brief.roomId}", round_id="${brief.roundId}".`,
    });
    return "awaiting_live";
  } else if (emp.transport_type === "acp_editor" && (await acpAdapter.heartbeat(emp.id))) {
    await acpAdapter.sendAssignment(emp, {
      ...assignment,
      prompt: `[Council Round 1] ${brief.title}: ${brief.problemStatement}`,
    });
    return "awaiting_live";
  } else if (emp.transport_type === "cli_pty" && (await cliPtyAdapter.heartbeat(emp.id))) {
    await cliPtyAdapter.sendAssignment(emp, {
      ...assignment,
      prompt: `[Council Round 1] ${brief.title}: ${brief.problemStatement}`,
    });
    return "awaiting_live";
  } else {
    proposal = fallbackProposal(emp, brief);
  }

  core.council.submitProposal({
    roomId: brief.roomId,
    roundId: brief.roundId,
    sessionEmployeeId: emp.id,
    summary: proposal.summary.slice(0, 1400),
    contentMarkdown: proposal.contentMarkdown,
  });
  return "submitted";
}

async function askSynchronously(
  emp: SessionEmployee,
  brief: CouncilBrief,
  ask: () => Promise<{ contentMarkdown: string; summary?: string }>,
): Promise<{ contentMarkdown: string; summary: string }> {
  try {
    const turn = await ask();
    return {
      contentMarkdown: turn.contentMarkdown,
      summary: turn.summary || turn.contentMarkdown.slice(0, 220),
    };
  } catch (err: unknown) {
    // Budget stops are a hard rule, not an agent failure: let the caller abort the council.
    if (err instanceof BudgetExceededError) throw err;
    return fallbackProposal(emp, brief, describeError(err));
  }
}

/** Read `SCORE: n` (1–10) from a critique reply; null when the reviewer gave no usable score. */
export function parseCritiqueScore(text: string): number | null {
  const match = /SCORE\s*[:=]\s*(\d{1,2})/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(MAX_SCORE, Math.max(MIN_SCORE, value)) : null;
}

/**
 * Every participant critiques every proposal except their own, and the proposal totals are
 * returned per alias. Scores come from the reviewer's own reply when it is an LLM; otherwise a
 * neutral score is used so non-LLM reviewers do not tilt the ranking.
 */
export async function crossCritique(
  deps: CommandRoutesDeps,
  brief: CouncilBrief,
  reviewerIds: readonly string[],
  proposals: readonly AnonymizedProposalView[],
): Promise<Map<string, number>> {
  const { core } = deps;
  const totals = new Map<string, number>(proposals.map((p) => [p.anonymous_alias, 0]));
  if (proposals.length < 2) return totals;

  for (const reviewerId of reviewerIds) {
    const reviewer = core.roster.getEmployeeById(reviewerId);
    if (!reviewer) continue;
    const ownAlias = core.council.getAuthorAlias(brief.roundId, reviewerId);
    for (const prop of proposals) {
      if (prop.anonymous_alias === ownAlias) continue;
      const { score, claim } = await reviewProposal(deps, reviewer, brief, prop);
      const rubricScores = {
        correctness: score,
        security: score,
        maintainability: score,
        feasibility: score,
      };
      core.council.submitCritique({
        roomId: brief.roomId,
        roundId: brief.roundId,
        reviewerSessionId: reviewerId,
        targetAnonymousAlias: prop.anonymous_alias,
        rubricScores,
        findings: [{ severity: "medium", category: "architecture", claim, is_hypothesis: false }],
      });
      totals.set(prop.anonymous_alias, (totals.get(prop.anonymous_alias) ?? 0) + score * 4);
    }
  }
  return totals;
}

async function reviewProposal(
  deps: CommandRoutesDeps,
  reviewer: SessionEmployee,
  brief: CouncilBrief,
  prop: AnonymizedProposalView,
): Promise<{ score: number; claim: string }> {
  const fallback = {
    score: NEUTRAL_SCORE,
    claim: `Cần xác định rõ tiêu chí nghiệm thu khi triển khai "${brief.title.slice(0, 60)}"`,
  };
  if (reviewer.transport_type !== "api_key" || !reviewer.credential_id) return fallback;
  try {
    const turn = await deps.apiKeyAdapter.sendAssignment(reviewer, {
      roomId: brief.roomId,
      roundId: brief.roundId,
      prompt: `Chấm điểm phản biện ẩn danh cho ${prop.anonymous_alias}:\n${prop.content_markdown}\n\nDòng đầu tiên PHẢI có dạng "SCORE: <1-10>". Sau đó viết 1 nhận xét kỹ thuật trọng tâm.`,
    });
    const text = turn.contentMarkdown.trim();
    const claim = text.replace(/^.*SCORE\s*[:=]\s*\d{1,2}.*$/im, "").trim() || fallback.claim;
    return { score: parseCritiqueScore(text) ?? NEUTRAL_SCORE, claim: claim.slice(0, 240) };
  } catch (err: unknown) {
    if (err instanceof BudgetExceededError) throw err;
    return fallback;
  }
}

/**
 * Undo a council that failed half-way: abort the room (sends participants back to their desks)
 * and park the epic ticket created for it, so nothing stays stuck in the war room.
 */
export function abortFailedCouncil(
  core: ArenaCoreContainer,
  roomId: string,
  createdEpicTicketId: string | null,
): void {
  try {
    core.council.steerOrResolveGate({ roomId, action: "abort_room" });
  } finally {
    if (createdEpicTicketId) {
      core.kanban.updateTicket(createdEpicTicketId, { kanban_column: "blocked" });
    }
  }
}
