import type { BlackboardArtifact, TaskTicket, TurnSubmission, WarRoomMeeting } from "@factory-arena/protocol";

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

export interface ContextSliceResult {
  promptContext: string;
  slicedTokens: number;
  naiveFullTranscriptTokens: number;
  savedTokens: number;
  reductionRatio: number;
}

export class PromptContextSlicer {
  public buildRoundContext(params: {
    room: WarRoomMeeting;
    roundNumber: number;
    stage: string;
    ticket?: TaskTicket | null;
    allHistoricalSubmissions: TurnSubmission[];
    priorRoundDigests: Array<{ alias: string; summary: string; artifactRef?: string }>;
    artifacts: BlackboardArtifact[];
  }): ContextSliceResult {
    const naiveFullText = [
      params.room.title,
      params.room.problem_statement,
      params.ticket?.description_markdown ?? "",
      ...params.allHistoricalSubmissions.map(
        (s) => `### ${s.anonymous_alias}\n${s.content_markdown}`
      ),
      ...params.artifacts.map((a) => `${a.title}: ${a.compact_digest.repeat(3)}`)
    ].join("\n\n");

    const naiveFullTranscriptTokens = estimateTokens(naiveFullText);

    const sections: string[] = [
      `# War Room: ${params.room.title} (Round ${params.roundNumber} · ${params.stage})`,
      `Problem: ${params.room.problem_statement || "See linked ticket"}`
    ];

    if (params.room.active_guidance.length > 0) {
      sections.push(
        `## Director Priority Guidance\n` +
          params.room.active_guidance.map((g) => `- ${g}`).join("\n")
      );
    }

    if (params.ticket) {
      sections.push(
        `## Active Ticket [${params.ticket.id}]: ${params.ticket.title}\n` +
          `Acceptance Criteria: ${params.ticket.acceptance_criteria.join("; ") || "Standard"}`
      );
    }

    if (params.priorRoundDigests.length > 0) {
      sections.push(
        `## Anonymized Prior-Round Digests\n` +
          params.priorRoundDigests
            .map(
              (d) =>
                `- **${d.alias}**: ${d.summary.slice(0, 380)}${
                  d.artifactRef ? ` (Full details: ${d.artifactRef})` : ""
                }`
            )
            .join("\n")
      );
    }

    if (params.artifacts.length > 0) {
      sections.push(
        `## Shared Blackboard Index (Fetch via arena_read_artifact if needed)\n` +
          params.artifacts
            .slice(0, 8)
            .map((a) => `- \`artifact://${a.id}\` [${a.kind}] ${a.title}: ${a.compact_digest}`)
            .join("\n")
      );
    }

    const promptContext = sections.join("\n\n");
    const slicedTokens = estimateTokens(promptContext);
    const savedTokens = Math.max(0, naiveFullTranscriptTokens - slicedTokens);
    const reductionRatio =
      naiveFullTranscriptTokens > 0 ? savedTokens / naiveFullTranscriptTokens : 0;

    return {
      promptContext,
      slicedTokens,
      naiveFullTranscriptTokens,
      savedTokens,
      reductionRatio
    };
  }
}
