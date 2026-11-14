import { type ArenaCoreContainer, LeaseConflictError } from "@factory-arena/core";
import {
  ArtifactKindSchema,
  CreateTicketInputSchema,
  IsolationModeSchema,
  KanbanColumnSchema,
} from "@factory-arena/protocol";
import { Hono } from "hono";
import { z } from "zod";

export function createTicketsAndArtifactsRoutes(core: ArenaCoreContainer): Hono {
  const router = new Hono();

  router.get("/tickets", (c) => {
    const assigneeSessionId = c.req.query("assigneeSessionId");
    const colRaw = c.req.query("kanbanColumn");
    const kanbanColumn = colRaw ? KanbanColumnSchema.parse(colRaw) : undefined;
    return c.json({
      tickets: core.kanban.listTickets({ assigneeSessionId, kanbanColumn }),
      active_leases: core.leases.listActiveLeases(),
    });
  });

  router.post("/tickets", async (c) => {
    const body = await c.req.json();
    const parsed = CreateTicketInputSchema.parse(body);
    const created = core.kanban.createTicket(parsed);
    return c.json(created, 201);
  });

  router.patch("/tickets/:ticketId", async (c) => {
    const ticketId = c.req.param("ticketId");
    const body = await c.req.json();
    const patchSchema = z.object({
      kanban_column: KanbanColumnSchema.optional(),
      assignee_session_id: z.string().nullable().optional(),
      reviewer_session_ids: z.array(z.string()).optional(),
    });
    const patch = patchSchema.parse(body);
    const updated = core.kanban.updateTicket(ticketId, patch);
    return c.json(updated);
  });

  router.post("/rooms/:roomId/beads/:beadId/lease", async (c) => {
    const roomId = c.req.param("roomId");
    const beadId = c.req.param("beadId");
    const body = await c.req.json();
    const schema = z.object({
      participant_id: z.string().min(1),
      isolation_mode: IsolationModeSchema,
      locked_globs: z.array(z.string()).optional(),
      repo_root_path: z.string().optional(),
      ttl_seconds: z.number().int().positive().default(600),
    });
    const parsed = schema.parse(body);
    const emp = core.roster.getEmployeeById(parsed.participant_id);
    if (!emp) {
      return c.json({ error: `SessionEmployee not found: ${parsed.participant_id}` }, 404);
    }
    const ticket = core.kanban.getTicketById(beadId);
    const room = core.council.getRoom(roomId);
    const repoRootPath =
      parsed.repo_root_path ?? ticket?.repo_root_path ?? room?.repo_root_path ?? process.cwd();

    try {
      const lease = core.leases.acquireLease({
        roomId,
        ticketId: beadId,
        sessionEmployeeId: emp.id,
        employeeCode: emp.employee_code,
        repoRootPath,
        baseBranch: ticket?.base_branch ?? room?.base_branch,
        isolationMode: parsed.isolation_mode,
        lockedGlobs: parsed.locked_globs,
        ttlSeconds: parsed.ttl_seconds,
      });
      return c.json({ lease }, 200);
    } catch (err) {
      if (err instanceof LeaseConflictError) {
        return c.json(
          {
            error: err.message,
            conflicting_lease: err.conflictingLease,
          },
          409,
        );
      }
      throw err;
    }
  });

  router.get("/artifacts", (c) => {
    const roomId = c.req.query("roomId");
    const ticketId = c.req.query("ticketId");
    return c.json({ artifacts: core.blackboard.listArtifacts({ roomId, ticketId }) });
  });

  router.post("/artifacts", async (c) => {
    const body = await c.req.json();
    const schema = z.object({
      room_id: z.string().optional(),
      ticket_id: z.string().optional(),
      author_session_id: z.string().min(1),
      kind: ArtifactKindSchema,
      title: z.string().min(1),
      content: z.string().min(1),
      compact_digest: z.string().max(600),
    });
    const parsed = schema.parse(body);
    const out = core.blackboard.publishArtifact({
      roomId: parsed.room_id,
      ticketId: parsed.ticket_id,
      authorSessionId: parsed.author_session_id,
      kind: parsed.kind,
      title: parsed.title,
      content: parsed.content,
      compactDigest: parsed.compact_digest,
    });
    return c.json(out, 201);
  });

  router.get("/artifacts/:artifactId", (c) => {
    const artifactId = c.req.param("artifactId");
    const found = core.blackboard.getArtifact(artifactId);
    if (!found) {
      return c.json({ error: "Artifact not found" }, 404);
    }
    return c.json(found);
  });

  return router;
}
