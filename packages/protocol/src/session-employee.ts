import { z } from "zod";
import { AgentCardSchema, TransportTypeSchema } from "./a2a-card.js";

export const DepartmentSchema = z.enum([
  "leadership",
  "architecture",
  "backend",
  "frontend",
  "security_qa",
  "devops"
]);
export type Department = z.infer<typeof DepartmentSchema>;

export const CapabilitySchema = z.enum([
  "propose",
  "critique",
  "vote",
  "read_repo",
  "edit_worktree",
  "run_tests",
  "moderate"
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const SpatialZoneSchema = z.enum([
  "at_desk",
  "walking_to_war_room",
  "at_war_room_table",
  "at_kanban_wall",
  "lounge_offline"
]);
export type SpatialZone = z.infer<typeof SpatialZoneSchema>;

export const AvatarPoseSchema = z.enum([
  "idle",
  "typing_code",
  "reading_files",
  "running_tests",
  "speaking",
  "hand_raised",
  "budget_paused"
]);
export type AvatarPose = z.infer<typeof AvatarPoseSchema>;

export const ConnectionStatusSchema = z.enum([
  "online",
  "busy",
  "waiting_permission",
  "degraded",
  "offline"
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const RoleTemplateSchema = z.object({
  id: z.string(),
  department: DepartmentSchema,
  job_title: z.string().min(1),
  reports_to_role_id: z.string().nullable().optional(),
  avatar_preset: z.string().default("teal-engineer"),
  default_capabilities: z.array(CapabilitySchema),
  monthly_budget_usd: z.number().min(0).default(25)
});
export type RoleTemplate = z.infer<typeof RoleTemplateSchema>;

export const SessionEmployeeSchema = z.object({
  id: z.string(),
  session_fingerprint: z.string().min(1),
  role_template_id: z.string(),
  employee_code: z.string().regex(/^[A-Z0-9-]+$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(1),
  department: DepartmentSchema,
  job_title: z.string().min(1),
  transport_type: TransportTypeSchema,
  system_instructions: z.string().optional(),
  model_identifier: z.string().optional(),
  credential_id: z.string().optional(),
  capabilities: z.array(CapabilitySchema),
  agent_card: AgentCardSchema.optional(),
  desk_slot_id: z.string().min(1),
  spatial_zone: SpatialZoneSchema.default("at_desk"),
  avatar_pose: AvatarPoseSchema.default("idle"),
  connection_status: ConnectionStatusSchema.default("online"),
  active_ticket_id: z.string().nullable().optional(),
  context_fill_pct: z.number().min(0).max(100).default(0),
  session_cost_usd: z.number().min(0).default(0),
  max_session_budget_usd: z.number().min(0).default(5),
  last_tool_call_summary: z.string().optional(),
  last_heartbeat_at: z.string().datetime()
});
export type SessionEmployee = z.infer<typeof SessionEmployeeSchema>;

export const RegisterEmployeeInputSchema = z.object({
  session_fingerprint: z.string().min(1).optional(),
  employee_code: z.string().regex(/^[A-Z0-9-]+$/),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  display_name: z.string().min(1),
  department: DepartmentSchema,
  job_title: z.string().min(1),
  transport_type: TransportTypeSchema,
  desk_slot_id: z.string().optional(),
  system_instructions: z.string().optional(),
  model_identifier: z.string().optional(),
  credential_id: z.string().optional(),
  capabilities: z.array(CapabilitySchema).default(["propose", "critique", "vote", "read_repo"]),
  remote_agent_card_url: z.string().url().optional(),
  cli_command: z.array(z.string()).optional(),
  max_session_budget_usd: z.number().min(0).optional(),
  workspace_uri: z.string().optional()
});
export type RegisterEmployeeInput = z.input<typeof RegisterEmployeeInputSchema>;

export const PermissionRequestSchema = z.object({
  id: z.string(),
  session_employee_id: z.string(),
  ticket_id: z.string().nullable().optional(),
  request_kind: z.enum([
    "shell_command",
    "destructive_git",
    "budget_topup",
    "clarification_question"
  ]),
  prompt_summary: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["pending", "allowed", "denied", "answered"]).default("pending"),
  answer_text: z.string().optional(),
  resolved_by: z.enum(["director_ui", "lead_agent"]).optional(),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable().optional()
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;
