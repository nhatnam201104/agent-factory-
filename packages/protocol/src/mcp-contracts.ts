import { z } from "zod";
import { AvatarPoseSchema, CapabilitySchema, DepartmentSchema } from "./session-employee.js";
import { ArtifactKindSchema, IsolationModeSchema } from "./kanban-workspace.js";
import {
  CitationRefSchema,
  CritiqueFindingSchema,
  DissentEntrySchema,
  RubricScoresSchema
} from "./deliberation.js";

export const MCPCheckinDeskInputSchema = z.object({
  session_fingerprint: z.string().min(1),
  employee_code: z.string().regex(/^[A-Z0-9-]+$/),
  display_name: z.string().optional(),
  department: DepartmentSchema,
  job_title: z.string().min(1),
  workspace_uri: z.string().optional()
});

export const MCPReportDeskActivityInputSchema = z.object({
  employee_id: z.string().min(1),
  avatar_pose: AvatarPoseSchema,
  last_tool_call_summary: z.string().optional(),
  context_fill_pct: z.number().min(0).max(100).optional(),
  permission_prompt: z.string().optional()
});

export const MCPJoinRoomInputSchema = z.object({
  room_id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  display_name: z.string().optional(),
  persona_role: z.string().min(1),
  capabilities: z.array(CapabilitySchema)
});

export const MCPPollAssignmentInputSchema = z.object({
  room_id: z.string().min(1),
  participant_id: z.string().min(1),
  wait_timeout_ms: z.number().int().min(0).max(60000).default(25000)
});

export const MCPSubmitProposalInputSchema = z.object({
  room_id: z.string().min(1),
  round_id: z.string().min(1),
  participant_id: z.string().min(1),
  summary: z.string().min(1).max(1500),
  content_markdown: z.string().min(1),
  citations: z.array(CitationRefSchema).optional()
});

export const MCPSubmitCritiqueInputSchema = z.object({
  room_id: z.string().min(1),
  round_id: z.string().min(1),
  reviewer_id: z.string().min(1),
  target_anonymous_alias: z.string().min(1),
  rubric_scores: RubricScoresSchema,
  findings: z.array(CritiqueFindingSchema),
  strengths_summary: z.string().optional(),
  blind_spots_summary: z.string().optional()
});

export const MCPCastVoteInputSchema = z.object({
  room_id: z.string().min(1),
  round_id: z.string().min(1),
  voter_id: z.string().min(1),
  ranked_aliases: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional()
});

export const MCPPublishDecisionInputSchema = z.object({
  room_id: z.string().min(1),
  moderator_id: z.string().min(1),
  winning_alias: z.string().min(1),
  final_plan_markdown: z.string().min(1),
  adopted_amendments: z.array(z.string()).optional(),
  dissent_log: z.array(DissentEntrySchema)
});

export const MCPPublishArtifactInputSchema = z.object({
  room_id: z.string().min(1),
  author_id: z.string().min(1),
  kind: ArtifactKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  compact_digest: z.string().max(600)
});

export const MCPClaimBeadInputSchema = z.object({
  room_id: z.string().min(1),
  bead_id: z.string().min(1),
  participant_id: z.string().min(1),
  isolation_mode: IsolationModeSchema,
  locked_globs: z.array(z.string()).optional()
});

export const ARENA_MCP_TOOL_NAMES = [
  "arena_checkin_desk",
  "arena_report_desk_activity",
  "arena_join_room",
  "arena_poll_assignment",
  "arena_submit_proposal",
  "arena_submit_critique",
  "arena_cast_vote",
  "arena_publish_decision",
  "arena_publish_artifact",
  "arena_claim_bead"
] as const;
