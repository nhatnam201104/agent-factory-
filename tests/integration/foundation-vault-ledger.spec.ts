import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaCore } from "@factory-arena/core";
import { describe, expect, it } from "vitest";

describe("Foundation: AES-256-GCM CredentialVault & Immutable JSONL EventLedger (T012)", () => {
  it("encrypts secrets at rest, never leaks plaintext to SQLite or JSONL, and replays monotonic sequences", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-foundation-"));
    const superSecret = "sk-live-SUPER-SECRET-VAULT-KEY-9988776655";
    const core = createArenaCore({
      stateDir: dir,
      masterPassphrase: "unit-test-master-passphrase"
    });

    try {
      const meta = core.vault.addCredential({
        label: "Primary OpenAI Key",
        provider_kind: "openai_compatible",
        raw_secret: superSecret,
        rate_limit_rpm: 60,
        max_cost_usd: 15
      });

      expect(meta.id).toMatch(/^cred_/);
      expect(JSON.stringify(meta)).not.toContain(superSecret);

      const resolved = core.vault.resolveDecryptedSecret(meta.id);
      expect(resolved.rawSecret).toBe(superSecret);

      const ev1 = core.ledger.append({
        roomId: "room-sec-test",
        eventType: "room.created",
        payload: {
          note: `Accidental secret echo: ${superSecret}`,
          raw_secret: superSecret
        }
      });
      const ev2 = core.ledger.append({
        roomId: "room-sec-test",
        eventType: "round.started",
        payload: { round: 1 }
      });

      expect(ev1.sequence_no).toBe(1);
      expect(ev2.sequence_no).toBe(2);

      // Inspect raw SQLite binary and raw JSONL file on disk for zero plaintext leakage (SC-005)
      const rawDbBytes = readFileSync(core.paths.dbPath);
      expect(rawDbBytes.includes(Buffer.from(superSecret, "utf8"))).toBe(false);

      const jsonlRaw = readFileSync(join(core.paths.eventsDir, "room-sec-test.jsonl"), "utf8");
      expect(jsonlRaw).not.toContain(superSecret);
      expect(jsonlRaw).toContain("[REDACTED_SECRET]");

      const replayed = core.ledger.readEvents("room-sec-test");
      expect(replayed).toHaveLength(2);
      expect(replayed[0].sequence_no).toBe(1);
      expect(replayed[1].sequence_no).toBe(2);
    } finally {
      core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
