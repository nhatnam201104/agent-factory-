import { z } from "zod";

export const ProtocolModeSchema = z.enum([
  "council",
  "adversarial",
  "roundtable",
  "execution_mesh",
]);
export type ProtocolMode = z.infer<typeof ProtocolModeSchema>;

export const RoomStatusSchema = z.enum([
  "draft",
  "diverging",
  "critiquing",
  "voting",
  "synthesizing",
  "awaiting_human_gate",
  "executing",
  "completed",
  "aborted",
]);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

/** Hard cap on deliberation rounds per room, including director-extended reopenings. */
export const MAX_DELIBERATION_ROUNDS = 10;

export const RoomConfigSchema = z.object({
  max_rounds: z.number().int().min(1).max(MAX_DELIBERATION_ROUNDS).default(3),
  turn_timeout_sec: z.number().int().min(5).max(600).default(90),
  quorum_ratio: z.number().min(0.1).max(1).default(0.67),
  tie_breaker: z.enum(["moderator", "human"]).default("human"),
  budget_tokens: z.number().int().min(1000).default(250000),
  max_cost_usd: z.number().min(0).default(10),
  anonymize_proposals: z.boolean().default(true),
  exclude_self_scoring: z.boolean().default(true),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

export const WarRoomMeetingSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  problem_statement: z.string().default(""),
  linked_ticket_id: z.string().nullable().optional(),
  repo_root_path: z.string().optional(),
  base_branch: z.string().optional(),
  protocol_mode: ProtocolModeSchema,
  status: RoomStatusSchema.default("draft"),
  participant_ids: z.array(z.string()).min(2),
  moderator_id: z.string(),
  active_guidance: z.array(z.string()).default([]),
  config: RoomConfigSchema,
  consumed_tokens: z.number().int().min(0).default(0),
  consumed_cost_usd: z.number().min(0).default(0),
  created_at: z.string().datetime(),
});
export type WarRoomMeeting = z.infer<typeof WarRoomMeetingSchema>;

export const RoundVisibilityStateSchema = z.enum(["sealed", "anonymized", "revealed"]);
export type RoundVisibilityState = z.infer<typeof RoundVisibilityStateSchema>;

export const DeliberationStageSchema = z.enum([
  "proposal",
  "critique",
  "rebuttal",
  "vote",
  "synthesis",
]);
export type DeliberationStage = z.infer<typeof DeliberationStageSchema>;

export const DeliberationRoundSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  round_number: z.number().int().min(1),
  stage: DeliberationStageSchema,
  visibility_state: RoundVisibilityStateSchema,
  started_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable().optional(),
});
export type DeliberationRound = z.infer<typeof DeliberationRoundSchema>;

export const CitationRefSchema = z.object({
  path: z.string().min(1),
  line_start: z.number().int().min(1).optional(),
  line_end: z.number().int().min(1).optional(),
  artifact_id: z.string().optional(),
});
export type CitationRef = z.infer<typeof CitationRefSchema>;

export const TurnSubmissionSchema = z.object({
  id: z.string(),
  round_id: z.string(),
  room_id: z.string(),
  session_employee_id: z.string(),
  anonymous_alias: z.string(),
  summary: z.string().min(1).max(1500),
  content_markdown: z.string().min(1),
  artifact_ref: z.string().optional(),
  citations: z.array(CitationRefSchema).default([]),
  prompt_tokens: z.number().int().min(0).default(0),
  completion_tokens: z.number().int().min(0).default(0),
  latency_ms: z.number().int().min(0).default(0),
  submitted_at: z.string().datetime(),
});
export type TurnSubmission = z.infer<typeof TurnSubmissionSchema>;

export const RubricScoresSchema = z.object({
  correctness: z.number().int().min(1).max(10),
  security: z.number().int().min(1).max(10),
  maintainability: z.number().int().min(1).max(10),
  feasibility: z.number().int().min(1).max(10),
});
export type RubricScores = z.infer<typeof RubricScoresSchema>;

export const CritiqueFindingSchema = z
  .object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    category: z.enum(["logic", "security", "performance", "edge_case", "architecture"]),
    claim: z.string().min(1),
    evidence_ref: z.string().optional(),
    is_hypothesis: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (
      (val.severity === "critical" || val.severity === "high") &&
      (!val.evidence_ref || val.evidence_ref.trim().length === 0) &&
      !val.is_hypothesis
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Critical or high findings require an explicit evidence_ref (file:line or artifact://) or is_hypothesis=true",
      });
    }
  });
export type CritiqueFinding = z.infer<typeof CritiqueFindingSchema>;

export const CritiqueSchema = z.object({
  id: z.string(),
  round_id: z.string(),
  room_id: z.string(),
  reviewer_session_id: z.string(),
  target_submission_id: z.string(),
  target_anonymous_alias: z.string(),
  rubric_scores: RubricScoresSchema,
  findings: z.array(CritiqueFindingSchema),
  strengths_summary: z.string().default(""),
  blind_spots_summary: z.string().default(""),
  created_at: z.string().datetime(),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const VoteSchema = z.object({
  id: z.string(),
  round_id: z.string(),
  room_id: z.string(),
  voter_session_id: z.string(),
  ranked_aliases: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().default(""),
  created_at: z.string().datetime(),
});
export type Vote = z.infer<typeof VoteSchema>;

export const DissentEntrySchema = z.object({
  issue: z.string().min(1),
  raised_by_alias: z.string().min(1),
  revisit_trigger: z.string().min(1),
});
export type DissentEntry = z.infer<typeof DissentEntrySchema>;

export const DecisionRecordSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  winning_submission_id: z.string(),
  winning_alias: z.string(),
  resolution_method: z.enum([
    "supermajority",
    "ranked_choice",
    "moderator_tiebreak",
    "human_override",
  ]),
  final_plan_markdown: z.string().min(1),
  adopted_amendments: z.array(z.string()).default([]),
  dissent_log: z.array(DissentEntrySchema),
  human_approved_by: z.string().nullable().optional(),
  approved_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
