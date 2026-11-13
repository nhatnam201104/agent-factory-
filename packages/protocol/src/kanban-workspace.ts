import { z } from "zod";

export const KanbanColumnSchema = z.enum([
  "backlog",
  "assigned",
  "in_progress",
  "in_war_room_debate",
  "in_review",
  "director_gate",
  "done",
  "blocked"
]);
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;

export const TicketPrioritySchema = z.enum([
  "p0_critical",
  "p1_high",
  "p2_normal",
  "p3_low"
]);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TaskTicketSchema = z.object({
  id: z.string(),
  parent_ticket_id: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  title: z.string().min(1),
  description_markdown: z.string().default(""),
  acceptance_criteria: z.array(z.string()).default([]),
  depends_on_tickets: z.array(z.string()).default([]),
  kanban_column: KanbanColumnSchema.default("backlog"),
  priority: TicketPrioritySchema.default("p2_normal"),
  assignee_session_id: z.string().nullable().optional(),
  reviewer_session_ids: z.array(z.string()).default([]),
  repo_root_path: z.string().optional(),
  base_branch: z.string().default("main"),
  retry_count: z.number().int().min(0).default(0),
  max_retries: z.number().int().min(0).default(2),
  failure_notes: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});
export type TaskTicket = z.infer<typeof TaskTicketSchema>;

export const CreateTicketInputSchema = z.object({
  id: z.string().optional(),
  parent_ticket_id: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  title: z.string().min(1),
  description_markdown: z.string().default(""),
  acceptance_criteria: z.array(z.string()).default([]),
  depends_on_tickets: z.array(z.string()).default([]),
  kanban_column: KanbanColumnSchema.default("backlog"),
  priority: TicketPrioritySchema.default("p2_normal"),
  assignee_session_id: z.string().nullable().optional(),
  reviewer_session_ids: z.array(z.string()).default([]),
  repo_root_path: z.string().optional(),
  base_branch: z.string().default("main")
});
export type CreateTicketInput = z.input<typeof CreateTicketInputSchema>;

export const IsolationModeSchema = z.enum(["git_worktree", "file_lock"]);
export type IsolationMode = z.infer<typeof IsolationModeSchema>;

export const WorkspaceLeaseSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  ticket_id: z.string(),
  session_employee_id: z.string(),
  repo_root_path: z.string(),
  isolation_mode: IsolationModeSchema,
  worktree_path: z.string().nullable().optional(),
  branch_name: z.string().nullable().optional(),
  locked_globs: z.array(z.string()).default([]),
  expires_at: z.string().datetime(),
  released_at: z.string().datetime().nullable().optional()
});
export type WorkspaceLease = z.infer<typeof WorkspaceLeaseSchema>;

export const ArtifactKindSchema = z.enum([
  "spec",
  "architecture_diagram",
  "code_diff",
  "test_report",
  "log_excerpt",
  "decision_record"
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const BlackboardArtifactSchema = z.object({
  id: z.string(),
  room_id: z.string().nullable().optional(),
  ticket_id: z.string().nullable().optional(),
  author_session_id: z.string(),
  kind: ArtifactKindSchema,
  title: z.string().min(1),
  mime_type: z.string().default("text/markdown"),
  storage_path: z.string(),
  sha256_hash: z.string().length(64),
  byte_size: z.number().int().min(0),
  compact_digest: z.string().max(600),
  version: z.number().int().min(1).default(1),
  created_at: z.string().datetime()
});
export type BlackboardArtifact = z.infer<typeof BlackboardArtifactSchema>;
