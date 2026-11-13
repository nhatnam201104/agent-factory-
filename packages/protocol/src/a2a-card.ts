import { z } from "zod";

export const TransportTypeSchema = z.enum([
  "mcp_bridge",
  "acp_editor",
  "api_key",
  "cli_pty",
  "a2a_remote"
]);
export type TransportType = z.infer<typeof TransportTypeSchema>;

export const AgentSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string())
});

export const AgentCardSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url(),
  version: z.string().min(1),
  protocolVersion: z.string().default("0.3.0"),
  provider: z
    .object({
      organization: z.string().optional(),
      transport: TransportTypeSchema.optional()
    })
    .optional(),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
    stateTransitionHistory: z.boolean().default(true),
    acpProtocolVersion: z.number().int().optional(),
    workspaceAccess: z
      .enum(["none", "read_only", "isolated_worktree", "file_lease"])
      .optional()
  }),
  authentication: z
    .object({
      schemes: z.array(z.enum(["Bearer", "LocalSessionToken", "MutualTLS"]))
    })
    .optional(),
  defaultInputModes: z.array(z.string()).default(["text/markdown", "application/json"]),
  defaultOutputModes: z.array(z.string()).default(["text/markdown", "application/json"]),
  skills: z.array(AgentSkillSchema).min(1)
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
