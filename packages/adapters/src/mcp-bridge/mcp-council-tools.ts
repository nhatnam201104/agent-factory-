import type { ArenaCoreContainer } from "@factory-arena/core";
import {
  MCPCastVoteInputSchema,
  MCPJoinRoomInputSchema,
  MCPPollAssignmentInputSchema,
  MCPPublishDecisionInputSchema,
  MCPSubmitCritiqueInputSchema,
  MCPSubmitProposalInputSchema
} from "@factory-arena/protocol";

export function handleCouncilMcpTool(
  core: ArenaCoreContainer,
  toolName: string,
  args: Record<string, unknown>
): unknown | undefined {
  if (toolName === "arena_join_room") {
    const input = MCPJoinRoomInputSchema.parse(args);
    const emp = core.roster.registerOrRebindSession({
      session_fingerprint: `mcp_bridge:${input.room_id}:${input.slug}`,
      employee_code: input.slug.toUpperCase().replace(/[^A-Z0-9-]+/g, "-"),
      slug: input.slug,
      display_name: input.display_name ?? input.slug,
      department: input.capabilities.includes("moderate") ? "leadership" : "architecture",
      job_title: input.persona_role,
      transport_type: "mcp_bridge",
      capabilities: input.capabilities
    });
    const room = core.council.getRoom(input.room_id);
    return {
      employee: emp,
      room_status: room?.status ?? "not_created_yet"
    };
  }

  if (toolName === "arena_poll_assignment") {
    const input = MCPPollAssignmentInputSchema.parse(args);
    return core.council.pollAssignment(input.room_id, input.participant_id);
  }

  if (toolName === "arena_submit_proposal") {
    const input = MCPSubmitProposalInputSchema.parse(args);
    return core.council.submitProposal({
      roomId: input.room_id,
      roundId: input.round_id,
      sessionEmployeeId: input.participant_id,
      summary: input.summary,
      contentMarkdown: input.content_markdown,
      citations: input.citations
    });
  }

  if (toolName === "arena_submit_critique") {
    const input = MCPSubmitCritiqueInputSchema.parse(args);
    return core.council.submitCritique({
      roomId: input.room_id,
      roundId: input.round_id,
      reviewerSessionId: input.reviewer_id,
      targetAnonymousAlias: input.target_anonymous_alias,
      rubricScores: input.rubric_scores,
      findings: input.findings,
      strengthsSummary: input.strengths_summary,
      blindSpotsSummary: input.blind_spots_summary
    });
  }

  if (toolName === "arena_cast_vote") {
    const input = MCPCastVoteInputSchema.parse(args);
    return core.council.castVote({
      roomId: input.room_id,
      roundId: input.round_id,
      voterSessionId: input.voter_id,
      rankedAliases: input.ranked_aliases,
      confidence: input.confidence,
      rationale: input.rationale
    });
  }

  if (toolName === "arena_publish_decision") {
    const input = MCPPublishDecisionInputSchema.parse(args);
    return core.council.publishDecision({
      roomId: input.room_id,
      moderatorId: input.moderator_id,
      winningAlias: input.winning_alias,
      finalPlanMarkdown: input.final_plan_markdown,
      adoptedAmendments: input.adopted_amendments,
      dissentLog: input.dissent_log
    });
  }

  return undefined;
}
