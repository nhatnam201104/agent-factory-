import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CreateCredentialInputSchema,
  type CreateCredentialInput,
  type CredentialMetadata,
  isoNow,
  prefixedUlid
} from "@factory-arena/protocol";
import { assertSafeRemoteUrl } from "./ssrf-guard.js";
import type { SecretScrubber } from "./secret-scrubber.js";

export class CredentialVault {
  private readonly masterKey: Buffer;

  constructor(
    private readonly db: DatabaseSync,
    private readonly scrubber: SecretScrubber,
    passphrase: string = process.env.FACTORY_ARENA_MASTER_KEY ?? "factory-arena-local-dev-vault-v1"
  ) {
    this.masterKey = scryptSync(passphrase, "factory-arena-aes256-salt-v1", 32);
  }

  public addCredential(rawInput: CreateCredentialInput): CredentialMetadata {
    const input = CreateCredentialInputSchema.parse(rawInput);
    if (input.base_url && input.provider_kind !== "ollama") {
      assertSafeRemoteUrl(input.base_url);
    }

    this.scrubber.registerSecret(input.raw_secret);

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(input.raw_secret, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    if (iv.byteLength !== 12 || authTag.byteLength !== 16) {
      throw new Error("Invalid AES-256-GCM IV or AuthTag length");
    }

    const id = prefixedUlid("cred");
    const createdAt = isoNow();
    const packedSecret = Buffer.concat([iv, authTag, ciphertext]);

    this.db
      .prepare(
        `INSERT INTO credential_profiles
          (id, label, provider_kind, base_url, encrypted_secret, rate_limit_rpm, max_cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.label,
        input.provider_kind,
        input.base_url ?? null,
        packedSecret,
        input.rate_limit_rpm ?? null,
        input.max_cost_usd ?? null,
        createdAt
      );

    return {
      id,
      label: input.label,
      provider_kind: input.provider_kind,
      base_url: input.base_url,
      rate_limit_rpm: input.rate_limit_rpm,
      max_cost_usd: input.max_cost_usd,
      created_at: createdAt
    };
  }

  public listCredentials(): CredentialMetadata[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, provider_kind, base_url, rate_limit_rpm, max_cost_usd, created_at
         FROM credential_profiles ORDER BY created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      label: String(r.label),
      provider_kind: r.provider_kind as CredentialMetadata["provider_kind"],
      base_url: r.base_url ? String(r.base_url) : undefined,
      rate_limit_rpm: r.rate_limit_rpm != null ? Number(r.rate_limit_rpm) : undefined,
      max_cost_usd: r.max_cost_usd != null ? Number(r.max_cost_usd) : undefined,
      created_at: String(r.created_at)
    }));
  }

  /**
   * Internal-only decryption for outbound API adapter calls.
   * Never expose the returned secret over HTTP, WebSocket, SSE, or JSONL logs.
   */
  public resolveDecryptedSecret(credentialId: string): {
    metadata: CredentialMetadata;
    rawSecret: string;
  } {
    const row = this.db
      .prepare(
        `SELECT id, label, provider_kind, base_url, encrypted_secret, rate_limit_rpm, max_cost_usd, created_at
         FROM credential_profiles WHERE id = ?`
      )
      .get(credentialId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Credential profile not found: ${credentialId}`);
    }

    const blob = Buffer.from(row.encrypted_secret as Uint8Array);
    const iv = blob.subarray(0, 12);
    const authTag = blob.subarray(12, 28);
    const ciphertext = blob.subarray(28);

    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
    this.scrubber.registerSecret(decrypted);

    return {
      metadata: {
        id: String(row.id),
        label: String(row.label),
        provider_kind: row.provider_kind as CredentialMetadata["provider_kind"],
        base_url: row.base_url ? String(row.base_url) : undefined,
        rate_limit_rpm: row.rate_limit_rpm != null ? Number(row.rate_limit_rpm) : undefined,
        max_cost_usd: row.max_cost_usd != null ? Number(row.max_cost_usd) : undefined,
        created_at: String(row.created_at)
      },
      rawSecret: decrypted
    };
  }
}
