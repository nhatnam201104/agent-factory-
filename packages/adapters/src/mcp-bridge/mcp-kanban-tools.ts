import type { ArenaCoreContainer } from "@factory-arena/core";
import {
  MCPClaimBeadInputSchema,
  MCPPublishArtifactInputSchema
} from "@factory-arena/protocol";

export function handleKanbanMcpTool(
  core: ArenaCoreContainer,
  toolName: string,
  args: Record<string, unknown>
): unknown | undefined {
  if (toolName === "arena_publish_artifact") {
    const input = MCPPublishArtifactInputSchema.parse(args);
    return core.blackboard.publishArtifact({
      roomId: input.room_id,
      authorSessionId: input.author_id,
      kind: input.kind,
      title: input.title,
      content: input.content,
      compactDigest: input.compact_digest
    });
  }

  if (toolName === "arena_read_artifact") {
    const artifactId = String(args.artifact_id ?? "");
    const found = core.blackboard.getArtifact(artifactId);
    if (!found) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return found;
  }

  if (toolName === "arena_claim_bead") {
    const input = MCPClaimBeadInputSchema.parse(args);
    const emp = core.roster.getEmployeeById(input.participant_id);
    if (!emp) {
      throw new Error(`Employee not found: ${input.participant_id}`);
    }
    const ticket = core.kanban.getTicketById(input.bead_id);
    const room = core.council.getRoom(input.room_id);
    const repoRootPath =
      ticket?.repo_root_path ?? room?.repo_root_path ?? process.cwd();

    const lease = core.leases.acquireLease({
      roomId: input.room_id,
      ticketId: input.bead_id,
      sessionEmployeeId: emp.id,
      employeeCode: emp.employee_code,
      repoRootPath,
      baseBranch: ticket?.base_branch ?? room?.base_branch,
      isolationMode: input.isolation_mode,
      lockedGlobs: input.locked_globs
    });

    if (ticket) {
      core.kanban.updateTicket(ticket.id, {
        assignee_session_id: emp.id,
        kanban_column: "in_progress"
      });
    }

    return { lease, employee_id: emp.id };
  }

  return undefined;
}
