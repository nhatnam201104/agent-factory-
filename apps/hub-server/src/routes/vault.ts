import { Hono } from "hono";
import type { ArenaCoreContainer } from "@factory-arena/core";
import { CreateCredentialInputSchema } from "@factory-arena/protocol";

export function createVaultRoutes(core: ArenaCoreContainer): Hono {
  const router = new Hono();

  router.get("/credentials", (c) => {
    return c.json({ credentials: core.vault.listCredentials() });
  });

  router.post("/credentials", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCredentialInputSchema.parse(body);
    const created = core.vault.addCredential(parsed);
    return c.json(created, 201);
  });

  return router;
}
