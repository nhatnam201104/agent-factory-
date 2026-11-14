import { randomBytes } from "node:crypto";
import { z } from "zod";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createUlid(nowMs: number = Date.now()): string {
  let time = Math.floor(nowMs);
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(16);
  let randPart = "";
  for (let i = 0; i < 16; i++) {
    randPart += CROCKFORD[bytes[i] % 32];
  }
  return timePart + randPart;
}

export function prefixedUlid(prefix: string, nowMs?: number): string {
  return `${prefix}_${createUlid(nowMs)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export const VisibilityScopeSchema = z.enum([
  "sealed_author_only",
  "anonymized_peers",
  "public_room",
]);
export type VisibilityScope = z.infer<typeof VisibilityScopeSchema>;

export const LedgerEventTypeSchema = z.enum([
  "employee.checked_in",
  "employee.pose_changed",
  "employee.budget_paused",
  "permission.requested",
  "permission.resolved",
  "ticket.created",
  "ticket.assigned",
  "ticket.status_changed",
  "room.created",
  "participant.joined",
  "participant.status_changed",
  "round.started",
  "proposal.submitted",
  "round.unsealed_anonymized",
  "critique.submitted",
  "vote.cast",
  "decision.synthesized",
  "human_gate.requested",
  "human_gate.resolved",
  "bead.created",
  "workspace_lease.acquired",
  "workspace_lease.conflict_detected",
  "bead.ralph_retry_triggered",
  "bead.verified",
  "artifact.published",
]);
export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;

export const TokenAccountingSchema = z.object({
  prompt_tokens: z.number().int().min(0).default(0),
  completion_tokens: z.number().int().min(0).default(0),
  saved_by_context_slicer_tokens: z.number().int().min(0).default(0),
  estimated_cost_usd: z.number().min(0).default(0),
});
export type TokenAccounting = z.infer<typeof TokenAccountingSchema>;

export const LedgerEventEnvelopeSchema = z.object({
  event_id: z.string().regex(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/),
  room_id: z.string().min(1),
  sequence_no: z.number().int().min(1),
  timestamp: z.string().datetime(),
  actor_session_employee_id: z.string().optional(),
  visibility: VisibilityScopeSchema.default("public_room"),
  event_type: LedgerEventTypeSchema,
  token_accounting: TokenAccountingSchema.optional(),
  payload: z.record(z.unknown()),
});
export type LedgerEventEnvelope = z.infer<typeof LedgerEventEnvelopeSchema>;

export const ProviderKindSchema = z.enum([
  "openai_compatible",
  "anthropic",
  "gemini",
  "ollama",
  "a2a_bearer",
  "mcp_token",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const CreateCredentialInputSchema = z.object({
  label: z.string().min(1).max(120),
  provider_kind: ProviderKindSchema,
  base_url: z.string().url().optional(),
  raw_secret: z.string().min(1),
  rate_limit_rpm: z.number().int().positive().optional(),
  max_cost_usd: z.number().min(0).optional(),
});
export type CreateCredentialInput = z.infer<typeof CreateCredentialInputSchema>;

export const CredentialMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider_kind: ProviderKindSchema,
  base_url: z.string().optional(),
  rate_limit_rpm: z.number().int().positive().optional(),
  max_cost_usd: z.number().min(0).optional(),
  created_at: z.string(),
});
export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>;
