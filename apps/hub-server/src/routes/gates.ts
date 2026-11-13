import { Hono } from "hono";
import type { ArenaCoreContainer } from "@factory-arena/core";
import { z } from "zod";

export function createGatesRoutes(core: ArenaCoreContainer): Hono {
  const router = new Hono();

  router.post("/rooms/:roomId/steer", async (c) => {
    const roomId = c.req.param("roomId");
    const body = await c.req.json();
    const schema = z.object({
      action: z.enum([
        "inject_guidance",
        "approve_decision",
        "reject_and_reopen",
        "abort_room"
      ]),
      guidance_markdown: z.string().optional(),
      selected_submission_id: z.string().optional(),
      approved_by: z.string().optional()
    });
    const parsed = schema.parse(body);
    const updated = core.council.steerOrResolveGate({
      roomId,
      action: parsed.action,
      guidanceMarkdown: parsed.guidance_markdown,
      approvedBy: parsed.approved_by
    });
    return c.json({ room: updated });
  });

  return router;
}
