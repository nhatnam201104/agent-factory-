import type { ArenaCoreContainer } from "@factory-arena/core";
import {
  AvatarPoseSchema,
  RegisterEmployeeInputSchema,
  SpatialZoneSchema,
} from "@factory-arena/protocol";
import { Hono } from "hono";
import { z } from "zod";

export function createParticipantsRoutes(core: ArenaCoreContainer): Hono {
  const router = new Hono();

  router.get("/participants", (c) => {
    return c.json({
      participants: core.roster.listEmployees(),
      pending_permissions: core.roster.listPendingPermissions(),
    });
  });

  router.post("/participants", async (c) => {
    const body = await c.req.json();
    const input = RegisterEmployeeInputSchema.parse({
      ...body,
      employee_code:
        body.employee_code ??
        String(body.slug ?? "AGT-01")
          .toUpperCase()
          .replace(/[^A-Z0-9-]+/g, "-"),
      department: body.department ?? "architecture",
      job_title: body.job_title ?? body.persona_role ?? "Specialist Agent",
    });
    const emp = core.roster.registerOrRebindSession(input);
    return c.json(emp, 201);
  });

  router.post("/participants/:employeeId/activity", async (c) => {
    const employeeId = c.req.param("employeeId");
    const body = await c.req.json();
    const schema = z.object({
      avatar_pose: AvatarPoseSchema,
      spatial_zone: SpatialZoneSchema.optional(),
      last_tool_call_summary: z.string().optional(),
      context_fill_pct: z.number().min(0).max(100).optional(),
      permission_prompt: z.string().optional(),
    });
    const parsed = schema.parse(body);
    const out = core.roster.reportDeskActivity({
      employeeId,
      avatarPose: parsed.avatar_pose,
      spatialZone: parsed.spatial_zone,
      lastToolCallSummary: parsed.last_tool_call_summary,
      contextFillPct: parsed.context_fill_pct,
      permissionPrompt: parsed.permission_prompt,
    });
    return c.json(out);
  });

  router.post("/permissions/:permissionId/resolve", async (c) => {
    const permissionId = c.req.param("permissionId");
    const body = await c.req.json();
    const schema = z.object({
      decision: z.enum(["allowed", "denied", "answered"]),
      answer_text: z.string().optional(),
      resolved_by: z.enum(["director_ui", "lead_agent"]).default("director_ui"),
    });
    const parsed = schema.parse(body);
    const out = core.roster.resolvePermission({
      permissionId,
      decision: parsed.decision,
      answerText: parsed.answer_text,
      resolvedBy: parsed.resolved_by,
    });
    return c.json(out);
  });

  return router;
}
