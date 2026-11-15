import { randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type CitationRef,
  type Critique,
  type CritiqueFinding,
  CritiqueSchema,
  type DecisionRecord,
  DecisionRecordSchema,
  type DeliberationRound,
  DeliberationRoundSchema,
  type DissentEntry,
  MAX_DELIBERATION_ROUNDS,
  type ProtocolMode,
  type RoomConfig,
  RoomConfigSchema,
  type RubricScores,
  type TaskTicket,
  type TurnSubmission,
  TurnSubmissionSchema,
  type Vote,
  VoteSchema,
  type WarRoomMeeting,
  WarRoomMeetingSchema,
  isoNow,
  prefixedUlid,
} from "@factory-arena/protocol";
import {
  INLINE_PAYLOAD_LIMIT_BYTES,
  type SharedBlackboardStore,
} from "../blackboard/artifact-store.js";
import {
  type ContextSliceResult,
  type PromptContextSlicer,
  estimateTokens,
} from "../blackboard/context-slicer.js";
import { ArenaClientError } from "../errors.js";
import type { OfficeRosterService } from "../office/office-roster.service.js";
import type { PayrollBudgetGuard } from "../office/payroll-budget.service.js";
import type { EventLedger } from "../storage/event-ledger.js";
import type { KanbanTaskService } from "../workspace/kanban-task.service.js";
import { parseStoredRoomConfig } from "./room-config.js";
import type { VoteTallyResult, WeightedVotingResolver } from "./voting.js";

function fisherYatesShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export interface AnonymizedProposalView {
  anonymous_alias: string;
  summary: string;
  content_markdown: string;
  artifact_ref?: string;
  citations: CitationRef[];
}

export class CouncilStateMachine {
  constructor(
    private readonly db: DatabaseSync,
    private readonly roster: OfficeRosterService,
    private readonly kanban: KanbanTaskService,
    private readonly blackboard: SharedBlackboardStore,
    private readonly slicer: PromptContextSlicer,
    private readonly voting: WeightedVotingResolver,
    private readonly ledger: EventLedger,
    private readonly budget?: PayrollBudgetGuard,
  ) {}

  public createRoom(params: {
    title: string;
    problemStatement?: string;
    linkedTicketId?: string | null;
    repoRootPath?: string;
    baseBranch?: string;
    protocolMode: ProtocolMode;
    participantIds: string[];
    moderatorId: string;
    config?: Partial<RoomConfig>;
  }): { room: WarRoomMeeting; round1: DeliberationRound } {
    const config = RoomConfigSchema.parse(params.config ?? {});
    const id = prefixedUlid("room");
    const createdAt = isoNow();

    const room = WarRoomMeetingSchema.parse({
      id,
      title: params.title,
      problem_statement: params.problemStatement ?? "",
      linked_ticket_id: params.linkedTicketId ?? null,
      repo_root_path: params.repoRootPath,
      base_branch: params.baseBranch,
      protocol_mode: params.protocolMode,
      status: "diverging",
      participant_ids: params.participantIds,
      moderator_id: params.moderatorId,
      active_guidance: [],
      config,
      consumed_tokens: 0,
      consumed_cost_usd: 0,
      created_at: createdAt,
    });

    this.db
      .prepare(
        `INSERT INTO war_room_meetings
          (id, title, problem_statement, linked_ticket_id, repo_root_path, base_branch, protocol_mode,
           status, participant_ids_json, moderator_id, active_guidance_json, config_json, consumed_tokens, consumed_cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(
        room.id,
        room.title,
        room.problem_statement,
        room.linked_ticket_id ?? null,
        room.repo_root_path ?? null,
        room.base_branch ?? null,
        room.protocol_mode,
        room.status,
        JSON.stringify(room.participant_ids),
        room.moderator_id,
        JSON.stringify(room.active_guidance),
        JSON.stringify(room.config),
        room.created_at,
      );

    this.roster.moveEmployeesToZone(params.participantIds, "at_war_room_table", "speaking");

    if (room.linked_ticket_id) {
      this.kanban.updateTicket(room.linked_ticket_id, { kanban_column: "in_war_room_debate" });
    }

    this.ledger.append({
      roomId: room.id,
      eventType: "room.created",
      payload: { room },
    });

    const round1 = this.startRound(room.id, 1, "proposal", "sealed");
    return { room, round1 };
  }

  public startRound(
    roomId: string,
    roundNumber: number,
    stage: DeliberationRound["stage"],
    visibilityState: DeliberationRound["visibility_state"],
  ): DeliberationRound {
    const round = DeliberationRoundSchema.parse({
      id: prefixedUlid("rnd"),
      room_id: roomId,
      round_number: roundNumber,
      stage,
      visibility_state: visibilityState,
      started_at: isoNow(),
      closed_at: null,
    });

    this.db
      .prepare(
        `INSERT INTO deliberation_rounds (id, room_id, round_number, stage, visibility_state, started_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        round.id,
        round.room_id,
        round.round_number,
        round.stage,
        round.visibility_state,
        round.started_at,
      );

    this.ledger.append({
      roomId,
      eventType: "round.started",
      payload: { round },
    });

    return round;
  }

  public submitProposal(params: {
    roomId: string;
    roundId: string;
    sessionEmployeeId: string;
    summary: string;
    contentMarkdown: string;
    citations?: CitationRef[];
    latencyMs?: number;
  }): { submission: TurnSubmission; unsealedForCritique: boolean } {
    const room = this.getRoom(params.roomId);
    const round = this.getRound(params.roundId);
    if (!room || !round || round.room_id !== room.id) {
      throw new Error(`Invalid room/round for proposal: ${params.roomId} / ${params.roundId}`);
    }
    if (!room.participant_ids.includes(params.sessionEmployeeId)) {
      throw new Error(`Employee ${params.sessionEmployeeId} is not a participant in ${room.id}`);
    }
    this.budget?.assertWithinBudget({
      sessionEmployeeId: params.sessionEmployeeId,
      roomId: room.id,
    });

    const existingMine = this.db
      .prepare(
        "SELECT id FROM turn_submissions WHERE round_id = ? AND session_employee_id = ? LIMIT 1",
      )
      .get(round.id, params.sessionEmployeeId) as { id: string } | undefined;
    if (existingMine) {
      throw new Error(`Duplicate proposal in same round for ${params.sessionEmployeeId}`);
    }

    let artifactRef: string | undefined;
    if (Buffer.byteLength(params.contentMarkdown, "utf8") > INLINE_PAYLOAD_LIMIT_BYTES) {
      const stored = this.blackboard.publishArtifact({
        roomId: room.id,
        ticketId: room.linked_ticket_id ?? undefined,
        authorSessionId: params.sessionEmployeeId,
        kind: "spec",
        title: `Proposal draft (${round.id})`,
        content: params.contentMarkdown,
        compactDigest: params.summary.slice(0, 580),
      });
      artifactRef = stored.pointer;
    }

    const promptTokens = estimateTokens(room.problem_statement);
    const completionTokens = estimateTokens(params.contentMarkdown);

    const submission = TurnSubmissionSchema.parse({
      id: prefixedUlid("sub"),
      round_id: round.id,
      room_id: room.id,
      session_employee_id: params.sessionEmployeeId,
      anonymous_alias: "SEALED_PENDING",
      summary: params.summary.slice(0, 1500),
      content_markdown: params.contentMarkdown,
      artifact_ref: artifactRef,
      citations: params.citations ?? [],
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      latency_ms: params.latencyMs ?? 0,
      submitted_at: isoNow(),
    });

    this.db
      .prepare(
        `INSERT INTO turn_submissions
          (id, round_id, room_id, session_employee_id, anonymous_alias, summary, content_markdown,
           artifact_ref, citations_json, prompt_tokens, completion_tokens, latency_ms, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        submission.id,
        submission.round_id,
        submission.room_id,
        submission.session_employee_id,
        submission.anonymous_alias,
        submission.summary,
        submission.content_markdown,
        submission.artifact_ref ?? null,
        JSON.stringify(submission.citations),
        submission.prompt_tokens,
        submission.completion_tokens,
        submission.latency_ms,
        submission.submitted_at,
      );

    this.ledger.append({
      roomId: room.id,
      eventType: "proposal.submitted",
      actorSessionEmployeeId: params.sessionEmployeeId,
      visibility: round.visibility_state === "sealed" ? "sealed_author_only" : "public_room",
      tokenAccounting: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        saved_by_context_slicer_tokens: 0,
        estimated_cost_usd: 0,
      },
      payload: {
        submission_id: submission.id,
        summary: submission.summary,
        content_markdown: submission.content_markdown,
      },
    });

    const countRow = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM turn_submissions WHERE round_id = ?")
      .get(round.id) as { cnt: number };

    let unsealedForCritique = false;
    if (
      Number(countRow.cnt) >= room.participant_ids.length &&
      round.visibility_state === "sealed"
    ) {
      this.unsealAndAnonymizeRound(room.id, round.id);
      unsealedForCritique = true;
    }

    const storedSubmission = this.getSubmissionById(submission.id);
    if (!storedSubmission) {
      throw new Error(`Submission not found after insert: ${submission.id}`);
    }
    return { submission: storedSubmission, unsealedForCritique };
  }

  public unsealAndAnonymizeRound(roomId: string, roundId: string): AnonymizedProposalView[] {
    const rows = this.db
      .prepare("SELECT * FROM turn_submissions WHERE round_id = ?")
      .all(roundId) as Array<Record<string, unknown>>;

    const shuffled = fisherYatesShuffle(rows);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const updateStmt = this.db.prepare(
      "UPDATE turn_submissions SET anonymous_alias = ? WHERE id = ?",
    );

    shuffled.forEach((row, index) => {
      const alias = `Proposal ${alphabet[index] ?? String(index + 1)}`;
      updateStmt.run(alias, String(row.id));
    });

    this.db
      .prepare(
        `UPDATE deliberation_rounds SET visibility_state = 'anonymized', stage = 'critique' WHERE id = ?`,
      )
      .run(roundId);
    this.db.prepare(`UPDATE war_room_meetings SET status = 'critiquing' WHERE id = ?`).run(roomId);

    const anonymizedViews = this.getVisibleSubmissionsForViewer(roundId, "__peer__");
    this.ledger.append({
      roomId,
      eventType: "round.unsealed_anonymized",
      visibility: "anonymized_peers",
      payload: {
        round_id: roundId,
        proposals: anonymizedViews,
      },
    });

    return anonymizedViews;
  }

  /**
   * Database-enforced visibility gate:
   * - While `sealed`, viewer X ONLY receives X's own submission; peers are strictly filtered in SQL.
   * - While `anonymized`, author/model identities are stripped and only `Proposal A..N` are returned.
   */
  /**
   * Alias of the submission a participant authored in a round (trusted, hub-side use only —
   * never expose this mapping to participants, it would break anonymity).
   */
  public getAuthorAlias(roundId: string, sessionEmployeeId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT anonymous_alias FROM turn_submissions WHERE round_id = ? AND session_employee_id = ? LIMIT 1",
      )
      .get(roundId, sessionEmployeeId) as { anonymous_alias: string } | undefined;
    return row ? String(row.anonymous_alias) : null;
  }

  public getVisibleSubmissionsForViewer(
    roundId: string,
    viewerSessionEmployeeId: string,
  ): AnonymizedProposalView[] {
    const round = this.getRound(roundId);
    if (!round) return [];

    if (round.visibility_state === "sealed") {
      const ownRows = this.db
        .prepare("SELECT * FROM turn_submissions WHERE round_id = ? AND session_employee_id = ?")
        .all(roundId, viewerSessionEmployeeId) as Array<Record<string, unknown>>;
      return ownRows.map((r) => ({
        anonymous_alias: String(r.anonymous_alias),
        summary: String(r.summary),
        content_markdown: String(r.content_markdown),
        artifact_ref: r.artifact_ref ? String(r.artifact_ref) : undefined,
        citations: JSON.parse(String(r.citations_json)),
      }));
    }

    const rows = this.db
      .prepare("SELECT * FROM turn_submissions WHERE round_id = ? ORDER BY anonymous_alias ASC")
      .all(roundId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      anonymous_alias: String(r.anonymous_alias),
      summary: String(r.summary),
      content_markdown: String(r.content_markdown),
      artifact_ref: r.artifact_ref ? String(r.artifact_ref) : undefined,
      citations: JSON.parse(String(r.citations_json)),
    }));
  }

  public pollAssignment(
    roomId: string,
    participantId: string,
  ): {
    room_status: WarRoomMeeting["status"];
    round: DeliberationRound;
    visible_proposals: AnonymizedProposalView[];
    context_slice: ContextSliceResult;
  } {
    const room = this.getRoom(roomId);
    if (!room) throw new Error(`Room not found: ${roomId}`);
    const rounds = this.listRounds(roomId);
    const activeRound = rounds[rounds.length - 1];
    const visible = this.getVisibleSubmissionsForViewer(activeRound.id, participantId);

    const allSubs =
      activeRound.visibility_state === "sealed"
        ? []
        : this.listRawSubmissionsForRound(activeRound.id);

    const ticket = room.linked_ticket_id ? this.kanban.getTicketById(room.linked_ticket_id) : null;
    const artifacts = this.blackboard.listArtifacts({ roomId });

    const slice = this.slicer.buildRoundContext({
      room,
      roundNumber: activeRound.round_number,
      stage: activeRound.stage,
      ticket,
      allHistoricalSubmissions: allSubs,
      priorRoundDigests: visible.map((v) => ({
        alias: v.anonymous_alias,
        summary: v.summary,
        artifactRef: v.artifact_ref,
      })),
      artifacts,
    });

    return {
      room_status: room.status,
      round: activeRound,
      visible_proposals: visible,
      context_slice: slice,
    };
  }

  public submitCritique(params: {
    roomId: string;
    roundId: string;
    reviewerSessionId: string;
    targetAnonymousAlias: string;
    rubricScores: RubricScores;
    findings: CritiqueFinding[];
    strengthsSummary?: string;
    blindSpotsSummary?: string;
  }): Critique {
    const room = this.getRoom(params.roomId);
    const round = this.getRound(params.roundId);
    if (!room || !round) {
      throw new Error(`Invalid room/round for critique: ${params.roomId}`);
    }
    if (round.visibility_state === "sealed") {
      throw new Error("Cannot submit critiques while round is still sealed");
    }

    const targetRow = this.db
      .prepare("SELECT * FROM turn_submissions WHERE round_id = ? AND anonymous_alias = ? LIMIT 1")
      .get(round.id, params.targetAnonymousAlias) as Record<string, unknown> | undefined;

    if (!targetRow) {
      throw new Error(`Target alias not found: ${params.targetAnonymousAlias}`);
    }

    if (
      room.config.exclude_self_scoring &&
      String(targetRow.session_employee_id) === params.reviewerSessionId
    ) {
      throw new Error("Self-scoring is disabled by room configuration (exclude_self_scoring=true)");
    }

    const critique = CritiqueSchema.parse({
      id: prefixedUlid("crt"),
      round_id: round.id,
      room_id: room.id,
      reviewer_session_id: params.reviewerSessionId,
      target_submission_id: String(targetRow.id),
      target_anonymous_alias: params.targetAnonymousAlias,
      rubric_scores: params.rubricScores,
      findings: params.findings,
      strengths_summary: params.strengthsSummary ?? "",
      blind_spots_summary: params.blindSpotsSummary ?? "",
      created_at: isoNow(),
    });

    this.db
      .prepare(
        `INSERT INTO critiques
          (id, round_id, room_id, reviewer_session_id, target_submission_id, target_anonymous_alias,
           rubric_scores_json, findings_json, strengths_summary, blind_spots_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        critique.id,
        critique.round_id,
        critique.room_id,
        critique.reviewer_session_id,
        critique.target_submission_id,
        critique.target_anonymous_alias,
        JSON.stringify(critique.rubric_scores),
        JSON.stringify(critique.findings),
        critique.strengths_summary,
        critique.blind_spots_summary,
        critique.created_at,
      );

    const reviewerCountRow = this.db
      .prepare(
        "SELECT COUNT(DISTINCT reviewer_session_id) AS cnt FROM critiques WHERE round_id = ?",
      )
      .get(round.id) as { cnt: number };
    const requiredReviewers = Math.max(
      1,
      Math.ceil(room.participant_ids.length * room.config.quorum_ratio - 0.02),
    );
    if (Number(reviewerCountRow.cnt) >= requiredReviewers) {
      this.db.prepare("UPDATE deliberation_rounds SET stage = 'vote' WHERE id = ?").run(round.id);
      this.db.prepare("UPDATE war_room_meetings SET status = 'voting' WHERE id = ?").run(room.id);
    }

    this.ledger.append({
      roomId: room.id,
      eventType: "critique.submitted",
      actorSessionEmployeeId: params.reviewerSessionId,
      visibility: "anonymized_peers",
      payload: {
        critique_id: critique.id,
        target_anonymous_alias: critique.target_anonymous_alias,
        rubric_scores: critique.rubric_scores,
        findings: critique.findings,
      },
    });

    return critique;
  }

  public castVote(params: {
    roomId: string;
    roundId: string;
    voterSessionId: string;
    rankedAliases: string[];
    confidence: number;
    rationale?: string;
  }): { vote: Vote; tally: VoteTallyResult } {
    const room = this.getRoom(params.roomId);
    const round = this.getRound(params.roundId);
    if (!room || !round) throw new Error(`Room/round not found: ${params.roomId}`);
    if (round.visibility_state === "sealed") {
      throw new Error("Cannot cast votes while round is still sealed");
    }
    if (round.stage === "critique") {
      this.db.prepare("UPDATE deliberation_rounds SET stage = 'vote' WHERE id = ?").run(round.id);
    }
    if (room.status === "critiquing") {
      this.db.prepare("UPDATE war_room_meetings SET status = 'voting' WHERE id = ?").run(room.id);
    }

    const vote = VoteSchema.parse({
      id: prefixedUlid("vot"),
      round_id: round.id,
      room_id: room.id,
      voter_session_id: params.voterSessionId,
      ranked_aliases: params.rankedAliases,
      confidence: params.confidence,
      rationale: params.rationale ?? "",
      created_at: isoNow(),
    });

    this.db
      .prepare(
        `INSERT INTO votes (id, round_id, room_id, voter_session_id, ranked_aliases_json, confidence, rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        vote.id,
        vote.round_id,
        vote.room_id,
        vote.voter_session_id,
        JSON.stringify(vote.ranked_aliases),
        vote.confidence,
        vote.rationale,
        vote.created_at,
      );

    const allVotes = this.listVotes(round.id);
    const aliases = this.getVisibleSubmissionsForViewer(round.id, "__peer__").map(
      (p) => p.anonymous_alias,
    );
    const tally = this.voting.tally(allVotes, aliases);

    if (allVotes.length >= Math.ceil(room.participant_ids.length * room.config.quorum_ratio)) {
      this.db
        .prepare(`UPDATE war_room_meetings SET status = 'synthesizing' WHERE id = ?`)
        .run(room.id);
    }

    const sliceCheck = this.buildContextForNextRound(room.id, Math.max(3, round.round_number + 1));

    this.ledger.append({
      roomId: room.id,
      eventType: "vote.cast",
      actorSessionEmployeeId: params.voterSessionId,
      tokenAccounting: {
        prompt_tokens: sliceCheck.slicedTokens,
        completion_tokens: estimateTokens(vote.rationale || "vote"),
        saved_by_context_slicer_tokens: sliceCheck.savedTokens,
        estimated_cost_usd: 0,
      },
      payload: {
        vote_id: vote.id,
        ranked_aliases: vote.ranked_aliases,
        confidence: vote.confidence,
        tally,
      },
    });

    return { vote, tally };
  }

  public buildContextForNextRound(roomId: string, roundNumber: number): ContextSliceResult {
    const room = this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room not found: ${roomId}`);
    }
    const rounds = this.listRounds(roomId);
    const allSubs = rounds.flatMap((r) => this.listRawSubmissionsForRound(r.id));
    const latestRound = rounds[rounds.length - 1];
    const visible = latestRound
      ? this.getVisibleSubmissionsForViewer(latestRound.id, "__peer__")
      : [];
    const artifacts = this.blackboard.listArtifacts({ roomId });
    const ticket = room.linked_ticket_id ? this.kanban.getTicketById(room.linked_ticket_id) : null;

    return this.slicer.buildRoundContext({
      room,
      roundNumber,
      stage: "synthesis",
      ticket,
      allHistoricalSubmissions: allSubs,
      priorRoundDigests: visible.map((v) => ({
        alias: v.anonymous_alias,
        summary: v.summary,
        artifactRef: v.artifact_ref,
      })),
      artifacts,
    });
  }

  public publishDecision(params: {
    roomId: string;
    moderatorId: string;
    winningAlias: string;
    finalPlanMarkdown: string;
    adoptedAmendments?: string[];
    dissentLog: DissentEntry[];
    resolutionMethod?: DecisionRecord["resolution_method"];
  }): DecisionRecord {
    const room = this.getRoom(params.roomId);
    if (!room) throw new Error(`Room not found: ${params.roomId}`);

    const rounds = this.listRounds(room.id);
    const latestRound = rounds[rounds.length - 1];
    const winningRow = this.db
      .prepare(
        "SELECT * FROM turn_submissions WHERE room_id = ? AND anonymous_alias = ? ORDER BY submitted_at DESC LIMIT 1",
      )
      .get(room.id, params.winningAlias) as Record<string, unknown> | undefined;

    if (!winningRow) {
      throw new Error(`Winning alias not found in room ${room.id}: ${params.winningAlias}`);
    }

    const votes = latestRound ? this.listVotes(latestRound.id) : [];
    const aliases = latestRound
      ? this.getVisibleSubmissionsForViewer(latestRound.id, "__peer__").map(
          (p) => p.anonymous_alias,
        )
      : [params.winningAlias];
    const tally = this.voting.tally(votes, aliases);
    const method: DecisionRecord["resolution_method"] =
      params.resolutionMethod ??
      (tally.isTie
        ? "moderator_tiebreak"
        : tally.resolutionMethod === "supermajority"
          ? "supermajority"
          : "ranked_choice");

    const decision = DecisionRecordSchema.parse({
      id: prefixedUlid("dec"),
      room_id: room.id,
      winning_submission_id: String(winningRow.id),
      winning_alias: params.winningAlias,
      resolution_method: method,
      final_plan_markdown: params.finalPlanMarkdown,
      adopted_amendments: params.adoptedAmendments ?? [],
      dissent_log: params.dissentLog,
      human_approved_by: null,
      approved_at: null,
      created_at: isoNow(),
    });

    this.db
      .prepare(
        `INSERT INTO decision_records
          (id, room_id, winning_submission_id, winning_alias, resolution_method,
           final_plan_markdown, adopted_amendments_json, dissent_log_json, human_approved_by, approved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        decision.id,
        decision.room_id,
        decision.winning_submission_id,
        decision.winning_alias,
        decision.resolution_method,
        decision.final_plan_markdown,
        JSON.stringify(decision.adopted_amendments),
        JSON.stringify(decision.dissent_log),
        decision.created_at,
      );

    if (latestRound) {
      this.db
        .prepare(
          `UPDATE deliberation_rounds SET visibility_state = 'revealed', stage = 'synthesis', closed_at = ? WHERE id = ?`,
        )
        .run(isoNow(), latestRound.id);
    }

    this.db
      .prepare(`UPDATE war_room_meetings SET status = 'awaiting_human_gate' WHERE id = ?`)
      .run(room.id);

    this.blackboard.publishArtifact({
      roomId: room.id,
      ticketId: room.linked_ticket_id ?? undefined,
      authorSessionId: params.moderatorId,
      kind: "decision_record",
      title: `DecisionRecord: ${room.title}`,
      content: params.finalPlanMarkdown,
      compactDigest: `Winner: ${params.winningAlias} (${method}). Dissents: ${params.dissentLog.length}`,
    });

    this.ledger.append({
      roomId: room.id,
      eventType: "decision.synthesized",
      actorSessionEmployeeId: params.moderatorId,
      payload: { decision },
    });
    this.ledger.append({
      roomId: room.id,
      eventType: "human_gate.requested",
      payload: { room_id: room.id, decision_id: decision.id },
    });

    return decision;
  }

  public steerOrResolveGate(params: {
    roomId: string;
    action: "inject_guidance" | "approve_decision" | "reject_and_reopen" | "abort_room";
    guidanceMarkdown?: string;
    selectedSubmissionId?: string;
    extendMaxRounds?: boolean;
    approvedBy?: string;
  }): WarRoomMeeting {
    const room = this.getRoom(params.roomId);
    if (!room) throw new Error(`Room not found: ${params.roomId}`);

    if (params.action === "inject_guidance" && params.guidanceMarkdown) {
      const updatedGuidance = [...room.active_guidance, params.guidanceMarkdown];
      this.db
        .prepare("UPDATE war_room_meetings SET active_guidance_json = ? WHERE id = ?")
        .run(JSON.stringify(updatedGuidance), room.id);
    } else if (params.action === "approve_decision") {
      this.approveDecision(room, params.approvedBy ?? "director", params.selectedSubmissionId);
    } else if (params.action === "reject_and_reopen") {
      this.budget?.assertWithinBudget({ roomId: room.id });
      const rounds = this.listRounds(room.id);
      const nextNum = rounds.length + 1;
      if (nextNum > room.config.max_rounds && !params.extendMaxRounds) {
        throw new ArenaClientError(
          `Cannot reopen room ${room.id}: max_rounds (${room.config.max_rounds}) reached`,
          409,
        );
      }
      if (nextNum > MAX_DELIBERATION_ROUNDS) {
        throw new ArenaClientError(
          `Cannot reopen room ${room.id}: hard limit of ${MAX_DELIBERATION_ROUNDS} rounds reached; abort the room or approve a submission instead`,
          409,
        );
      }
      const nextConfig =
        nextNum > room.config.max_rounds ? { ...room.config, max_rounds: nextNum } : room.config;
      const updatedGuidance = params.guidanceMarkdown
        ? [...room.active_guidance, params.guidanceMarkdown]
        : room.active_guidance;
      this.db
        .prepare(
          `UPDATE war_room_meetings
           SET active_guidance_json = ?, config_json = ?, status = 'diverging'
           WHERE id = ?`,
        )
        .run(JSON.stringify(updatedGuidance), JSON.stringify(nextConfig), room.id);
      this.startRound(room.id, nextNum, "proposal", "sealed");
    } else if (params.action === "abort_room") {
      // A finished room no longer owns its participants; they may already sit in a newer meeting.
      if (room.status === "aborted" || room.status === "completed") {
        throw new ArenaClientError(`Room ${room.id} is already ${room.status}`, 409);
      }
      this.db.prepare(`UPDATE war_room_meetings SET status = 'aborted' WHERE id = ?`).run(room.id);
      this.roster.moveEmployeesToZone(room.participant_ids, "at_desk", "idle");
    }

    this.ledger.append({
      roomId: room.id,
      eventType: "human_gate.resolved",
      actorSessionEmployeeId: "director",
      payload: {
        action: params.action,
        guidance_markdown: params.guidanceMarkdown,
      },
    });

    const updatedRoom = this.getRoom(room.id);
    if (!updatedRoom) {
      throw new Error(`Room disappeared after gate resolution: ${room.id}`);
    }
    return updatedRoom;
  }

  /**
   * Director sign-off. Without a selection it approves the decision currently awaiting the gate
   * (never a stale one from a round that was rejected and reopened). With a selection it can
   * override the winner; if the previous decision was already decomposed into beads, the override
   * becomes a new DecisionRecord and the superseded beads are retired so the board matches the plan.
   */
  private approveDecision(
    room: WarRoomMeeting,
    approver: string,
    selectedSubmissionId: string | undefined,
  ): void {
    const now = isoNow();
    let decision = this.getLatestDecision(room.id);

    if (selectedSubmissionId) {
      decision = this.applyWinnerSelection(room, decision, selectedSubmissionId, approver, now);
    } else {
      if (room.status !== "awaiting_human_gate" || !decision) {
        throw new ArenaClientError(
          `Room ${room.id} has no decision awaiting approval (status: ${room.status}); publish a decision or select a submission first`,
          409,
        );
      }
      this.db
        .prepare("UPDATE decision_records SET human_approved_by = ?, approved_at = ? WHERE id = ?")
        .run(approver, now, decision.id);
      decision = this.getLatestDecision(room.id);
    }

    this.db.prepare("UPDATE war_room_meetings SET status = 'executing' WHERE id = ?").run(room.id);
    this.roster.moveEmployeesToZone(room.participant_ids, "at_desk", "typing_code");
    if (room.linked_ticket_id) {
      this.kanban.updateTicket(room.linked_ticket_id, { kanban_column: "in_progress" });
    }
    if (decision) this.decomposeDecisionIntoBeads(room, decision);
  }

  private applyWinnerSelection(
    room: WarRoomMeeting,
    current: DecisionRecord | null,
    selectedSubmissionId: string,
    approver: string,
    now: string,
  ): DecisionRecord | null {
    const chosenRow = this.db
      .prepare(
        `SELECT * FROM turn_submissions
         WHERE room_id = ? AND (id = ? OR anonymous_alias = ?)
         ORDER BY submitted_at DESC LIMIT 1`,
      )
      .get(room.id, selectedSubmissionId, selectedSubmissionId) as
      | Record<string, unknown>
      | undefined;
    if (!chosenRow) {
      throw new ArenaClientError(
        `Selected submission not found in room ${room.id}: ${selectedSubmissionId}`,
        404,
      );
    }
    const chosenId = String(chosenRow.id);
    const chosenAlias = String(chosenRow.anonymous_alias);
    const sameWinner = current?.winning_submission_id === chosenId;

    if (current && (sameWinner || !this.hasBeads(current.id))) {
      // Nothing was built from this decision yet (or the winner is unchanged): amend in place.
      const nextPlan = sameWinner
        ? current.final_plan_markdown
        : String(chosenRow.content_markdown);
      this.db
        .prepare(
          `UPDATE decision_records
           SET winning_submission_id = ?, winning_alias = ?, resolution_method = 'human_override',
               final_plan_markdown = ?, human_approved_by = ?, approved_at = ?
           WHERE id = ?`,
        )
        .run(chosenId, chosenAlias, nextPlan, approver, now, current.id);
      return this.getLatestDecision(room.id);
    }

    if (current) this.retireBeads(current.id, `Superseded by director override (${chosenAlias})`);
    const override = DecisionRecordSchema.parse({
      id: prefixedUlid("dec"),
      room_id: room.id,
      winning_submission_id: chosenId,
      winning_alias: chosenAlias,
      resolution_method: "human_override",
      final_plan_markdown: String(chosenRow.content_markdown),
      adopted_amendments: [],
      dissent_log: [],
      human_approved_by: approver,
      approved_at: now,
      created_at: now,
    });
    this.db
      .prepare(
        `INSERT INTO decision_records
          (id, room_id, winning_submission_id, winning_alias, resolution_method,
           final_plan_markdown, adopted_amendments_json, dissent_log_json, human_approved_by, approved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        override.id,
        override.room_id,
        override.winning_submission_id,
        override.winning_alias,
        override.resolution_method,
        override.final_plan_markdown,
        JSON.stringify(override.adopted_amendments),
        JSON.stringify(override.dissent_log),
        override.human_approved_by ?? null,
        override.approved_at ?? null,
        override.created_at,
      );
    return this.getLatestDecision(room.id);
  }

  private hasBeads(decisionId: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM task_tickets WHERE decision_id = ? LIMIT 1").get(decisionId),
    );
  }

  /** Park unfinished beads of an overridden plan: unassign, block, and record why. */
  private retireBeads(decisionId: string, reason: string): void {
    const rows = this.db
      .prepare(
        "SELECT id, assignee_session_id, failure_notes_json FROM task_tickets WHERE decision_id = ? AND kanban_column != 'done'",
      )
      .all(decisionId) as Array<{
      id: string;
      assignee_session_id: string | null;
      failure_notes_json: string;
    }>;
    for (const row of rows) {
      const assignee = row.assignee_session_id ? String(row.assignee_session_id) : null;
      if (assignee && this.roster.getEmployeeById(assignee)?.active_ticket_id === row.id) {
        this.roster.setActiveTicket(assignee, null);
      }
      const notes = [...(JSON.parse(String(row.failure_notes_json)) as string[]), reason];
      this.db
        .prepare("UPDATE task_tickets SET failure_notes_json = ? WHERE id = ?")
        .run(JSON.stringify(notes), row.id);
      this.kanban.updateTicket(String(row.id), {
        kanban_column: "blocked",
        assignee_session_id: null,
      });
    }
  }

  public decomposeDecisionIntoBeads(room: WarRoomMeeting, decision: DecisionRecord): TaskTicket[] {
    const existingRows = this.db
      .prepare("SELECT id FROM task_tickets WHERE decision_id = ?")
      .all(decision.id) as Array<{ id: string }>;
    if (existingRows.length > 0) {
      return existingRows
        .map((r) => this.kanban.getTicketById(String(r.id)))
        .filter((t): t is TaskTicket => t !== null);
    }

    const bulletLines = decision.final_plan_markdown
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "").trim())
      .filter((line, idx, arr) => {
        const rawLine = decision.final_plan_markdown.split(/\r?\n/)[idx] ?? "";
        return (
          /^\s*(?:[-*+]|\d+[.)])\s+/.test(rawLine) && line.length > 0 && arr.indexOf(line) === idx
        );
      });

    const planHeadline = decision.final_plan_markdown
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line.length > 0);

    const rawItems =
      bulletLines.length > 0
        ? [...bulletLines, ...decision.adopted_amendments]
        : [
            planHeadline ? `Implement: ${planHeadline.slice(0, 140)}` : `Implement: ${room.title}`,
            ...decision.adopted_amendments,
          ];

    const uniqueItems = Array.from(
      new Set(rawItems.map((item) => item.trim()).filter((item) => item.length > 0)),
    );

    const parentTicket = room.linked_ticket_id
      ? this.kanban.getTicketById(room.linked_ticket_id)
      : null;

    let createdBeads: TaskTicket[];
    if (parentTicket) {
      createdBeads = this.kanban.decomposeEpic({
        parentTicketId: parentTicket.id,
        decisionId: decision.id,
        subtasks: uniqueItems.map((title, idx) => ({
          title,
          assigneeSessionId:
            room.participant_ids.length > 0
              ? room.participant_ids[idx % room.participant_ids.length]
              : undefined,
          acceptanceCriteria: [
            `Verified against DecisionRecord ${decision.id} (${decision.winning_alias})`,
          ],
          dependsOnIndex: idx > 0 && bulletLines.length > 1 ? [0] : [],
        })),
      });
    } else {
      createdBeads = uniqueItems.map((title, idx) => {
        const assigneeId =
          room.participant_ids.length > 0
            ? room.participant_ids[idx % room.participant_ids.length]
            : null;
        return this.kanban.createTicket({
          parent_ticket_id: null,
          decision_id: decision.id,
          title,
          description_markdown: `Auto-decomposed from War Room **${room.title}** (${decision.winning_alias}).`,
          acceptance_criteria: [
            `Verified against DecisionRecord ${decision.id} (${decision.winning_alias})`,
          ],
          assignee_session_id: assigneeId,
          kanban_column: assigneeId ? "assigned" : "backlog",
          priority: "p1_high",
          repo_root_path: room.repo_root_path,
          base_branch: room.base_branch ?? "main",
        });
      });
    }

    for (const bead of createdBeads) {
      this.ledger.append({
        roomId: room.id,
        eventType: "bead.created",
        actorSessionEmployeeId: bead.assignee_session_id ?? undefined,
        payload: {
          decision_id: decision.id,
          ticket: bead,
        },
      });
    }

    return createdBeads;
  }

  public getRoom(roomId: string): WarRoomMeeting | null {
    const row = this.db.prepare("SELECT * FROM war_room_meetings WHERE id = ?").get(roomId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRoom(row) : null;
  }

  public listRooms(): WarRoomMeeting[] {
    const rows = this.db
      .prepare("SELECT * FROM war_room_meetings ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRoom(r));
  }

  public getRound(roundId: string): DeliberationRound | null {
    const row = this.db.prepare("SELECT * FROM deliberation_rounds WHERE id = ?").get(roundId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRound(row) : null;
  }

  public listRounds(roomId: string): DeliberationRound[] {
    const rows = this.db
      .prepare("SELECT * FROM deliberation_rounds WHERE room_id = ? ORDER BY round_number ASC")
      .all(roomId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRound(r));
  }

  public listCritiques(roomId: string): Critique[] {
    const rows = this.db
      .prepare("SELECT * FROM critiques WHERE room_id = ? ORDER BY created_at ASC")
      .all(roomId) as Array<Record<string, unknown>>;
    return rows.map((r) =>
      CritiqueSchema.parse({
        id: String(r.id),
        round_id: String(r.round_id),
        room_id: String(r.room_id),
        reviewer_session_id: String(r.reviewer_session_id),
        target_submission_id: String(r.target_submission_id),
        target_anonymous_alias: String(r.target_anonymous_alias),
        rubric_scores: JSON.parse(String(r.rubric_scores_json)),
        findings: JSON.parse(String(r.findings_json)),
        strengths_summary: String(r.strengths_summary),
        blind_spots_summary: String(r.blind_spots_summary),
        created_at: String(r.created_at),
      }),
    );
  }

  public listVotes(roundId: string): Vote[] {
    const rows = this.db
      .prepare("SELECT * FROM votes WHERE round_id = ? ORDER BY created_at ASC")
      .all(roundId) as Array<Record<string, unknown>>;
    return rows.map((r) =>
      VoteSchema.parse({
        id: String(r.id),
        round_id: String(r.round_id),
        room_id: String(r.room_id),
        voter_session_id: String(r.voter_session_id),
        ranked_aliases: JSON.parse(String(r.ranked_aliases_json)),
        confidence: Number(r.confidence),
        rationale: String(r.rationale),
        created_at: String(r.created_at),
      }),
    );
  }

  public getLatestDecision(roomId: string): DecisionRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM decision_records WHERE room_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(roomId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return DecisionRecordSchema.parse({
      id: String(row.id),
      room_id: String(row.room_id),
      winning_submission_id: String(row.winning_submission_id),
      winning_alias: String(row.winning_alias),
      resolution_method: row.resolution_method,
      final_plan_markdown: String(row.final_plan_markdown),
      adopted_amendments: JSON.parse(String(row.adopted_amendments_json)),
      dissent_log: JSON.parse(String(row.dissent_log_json)),
      human_approved_by: row.human_approved_by ? String(row.human_approved_by) : null,
      approved_at: row.approved_at ? String(row.approved_at) : null,
      created_at: String(row.created_at),
    });
  }

  private getSubmissionById(id: string): TurnSubmission | null {
    const row = this.db.prepare("SELECT * FROM turn_submissions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapSubmission(row) : null;
  }

  private listRawSubmissionsForRound(roundId: string): TurnSubmission[] {
    const rows = this.db
      .prepare("SELECT * FROM turn_submissions WHERE round_id = ? ORDER BY submitted_at ASC")
      .all(roundId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapSubmission(r));
  }

  private mapRoom(row: Record<string, unknown>): WarRoomMeeting {
    return WarRoomMeetingSchema.parse({
      id: String(row.id),
      title: String(row.title),
      problem_statement: String(row.problem_statement),
      linked_ticket_id: row.linked_ticket_id ? String(row.linked_ticket_id) : null,
      repo_root_path: row.repo_root_path ? String(row.repo_root_path) : undefined,
      base_branch: row.base_branch ? String(row.base_branch) : undefined,
      protocol_mode: row.protocol_mode,
      status: row.status,
      participant_ids: JSON.parse(String(row.participant_ids_json)),
      moderator_id: String(row.moderator_id),
      active_guidance: JSON.parse(String(row.active_guidance_json)),
      config: parseStoredRoomConfig(String(row.config_json)),
      consumed_tokens: Number(row.consumed_tokens),
      consumed_cost_usd: Number(row.consumed_cost_usd),
      created_at: String(row.created_at),
    });
  }

  private mapRound(row: Record<string, unknown>): DeliberationRound {
    return DeliberationRoundSchema.parse({
      id: String(row.id),
      room_id: String(row.room_id),
      round_number: Number(row.round_number),
      stage: row.stage,
      visibility_state: row.visibility_state,
      started_at: String(row.started_at),
      closed_at: row.closed_at ? String(row.closed_at) : null,
    });
  }

  private mapSubmission(row: Record<string, unknown>): TurnSubmission {
    return TurnSubmissionSchema.parse({
      id: String(row.id),
      round_id: String(row.round_id),
      room_id: String(row.room_id),
      session_employee_id: String(row.session_employee_id),
      anonymous_alias: String(row.anonymous_alias),
      summary: String(row.summary),
      content_markdown: String(row.content_markdown),
      artifact_ref: row.artifact_ref ? String(row.artifact_ref) : undefined,
      citations: JSON.parse(String(row.citations_json)),
      prompt_tokens: Number(row.prompt_tokens),
      completion_tokens: Number(row.completion_tokens),
      latency_ms: Number(row.latency_ms),
      submitted_at: String(row.submitted_at),
    });
  }
}
