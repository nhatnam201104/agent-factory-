import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ArenaCoreContainer } from "@factory-arena/core";
import { ProtocolModeSchema, RoomConfigSchema } from "@factory-arena/protocol";
import { z } from "zod";

export function createRoomsRoutes(core: ArenaCoreContainer): Hono {
  const router = new Hono();

  router.get("/rooms", (c) => {
    const rooms = core.council.listRooms().map((r) => ({
      ...r,
      rounds: core.council.listRounds(r.id),
      critiques: core.council.listCritiques(r.id),
      latest_decision: core.council.getLatestDecision(r.id)
    }));
    return c.json({ rooms });
  });

  router.post("/rooms", async (c) => {
    const body = await c.req.json();
    const schema = z.object({
      title: z.string().min(1),
      problem_statement: z.string().optional(),
      linked_ticket_id: z.string().nullable().optional(),
      repo_root_path: z.string().optional(),
      base_branch: z.string().optional(),
      protocol_mode: ProtocolModeSchema,
      participant_ids: z.array(z.string()).min(2),
      moderator_id: z.string().min(1),
      config: RoomConfigSchema.partial().optional()
    });
    const parsed = schema.parse(body);
    const created = core.council.createRoom({
      title: parsed.title,
      problemStatement: parsed.problem_statement,
      linkedTicketId: parsed.linked_ticket_id,
      repoRootPath: parsed.repo_root_path,
      baseBranch: parsed.base_branch,
      protocolMode: parsed.protocol_mode,
      participantIds: parsed.participant_ids,
      moderatorId: parsed.moderator_id,
      config: parsed.config
    });
    return c.json(created, 201);
  });

  router.get("/rooms/:roomId/events", (c) => {
    const roomId = c.req.param("roomId");
    const viewerParticipantId = c.req.query("viewerParticipantId");

    return streamSSE(c, async (stream) => {
      const history = core.ledger.readEvents(roomId, viewerParticipantId);
      for (const ev of history) {
        await stream.writeSSE({
          id: String(ev.sequence_no),
          event: ev.event_type,
          data: JSON.stringify(ev)
        });
      }

      let closed = false;
      const unsubscribe = core.ledger.subscribe((ev) => {
        if (closed || ev.room_id !== roomId) return;
        if (
          viewerParticipantId &&
          ev.visibility === "sealed_author_only" &&
          ev.actor_session_employee_id !== viewerParticipantId
        ) {
          return;
        }
        const safeEv =
          viewerParticipantId && ev.visibility === "anonymized_peers"
            ? { ...ev, actor_session_employee_id: "anonymous" }
            : ev;

        void stream.writeSSE({
          id: String(safeEv.sequence_no),
          event: safeEv.event_type,
          data: JSON.stringify(safeEv)
        });
      });

      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });

      // Flush initial history immediately unless client requests live hold
      if (c.req.query("live") !== "true") {
        closed = true;
        unsubscribe();
      } else {
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
        });
      }
    });
  });

  return router;
}
