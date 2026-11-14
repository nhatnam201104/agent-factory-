import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type ArtifactKind,
  type BlackboardArtifact,
  BlackboardArtifactSchema,
  isoNow,
  prefixedUlid,
} from "@factory-arena/protocol";
import type { EventLedger } from "../storage/event-ledger.js";
import type { LogCrusher } from "./log-crusher.js";

export const INLINE_PAYLOAD_LIMIT_BYTES = 2048;

export class SharedBlackboardStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly artifactsDir: string,
    private readonly ledger: EventLedger,
    private readonly crusher: LogCrusher,
  ) {
    mkdirSync(this.artifactsDir, { recursive: true });
  }

  public publishArtifact(params: {
    roomId?: string;
    ticketId?: string;
    authorSessionId: string;
    kind: ArtifactKind;
    title: string;
    content: string;
    compactDigest: string;
    mimeType?: string;
  }): { artifact: BlackboardArtifact; pointer: string } {
    const normalizedContent =
      params.kind === "log_excerpt" || params.kind === "test_report"
        ? this.crusher.crush(params.content).compressed
        : params.content;

    const sha256 = createHash("sha256").update(normalizedContent, "utf8").digest("hex");
    const storagePath = join(this.artifactsDir, `${sha256}.md`);
    if (!existsSync(storagePath)) {
      writeFileSync(storagePath, normalizedContent, "utf8");
    }

    const existingCountRow = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM blackboard_artifacts WHERE COALESCE(room_id,'') = ? AND title = ?`,
      )
      .get(params.roomId ?? "", params.title) as { cnt: number };

    const version = Number(existingCountRow?.cnt ?? 0) + 1;
    const id = prefixedUlid("art");
    const createdAt = isoNow();
    const compactDigest = params.compactDigest.slice(0, 600);
    const byteSize = Buffer.byteLength(normalizedContent, "utf8");

    const artifact = BlackboardArtifactSchema.parse({
      id,
      room_id: params.roomId ?? null,
      ticket_id: params.ticketId ?? null,
      author_session_id: params.authorSessionId,
      kind: params.kind,
      title: params.title,
      mime_type: params.mimeType ?? "text/markdown",
      storage_path: storagePath,
      sha256_hash: sha256,
      byte_size: byteSize,
      compact_digest: compactDigest,
      version,
      created_at: createdAt,
    });

    this.db
      .prepare(
        `INSERT INTO blackboard_artifacts
          (id, room_id, ticket_id, author_session_id, kind, title, mime_type, storage_path, sha256_hash, byte_size, compact_digest, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.room_id ?? null,
        artifact.ticket_id ?? null,
        artifact.author_session_id,
        artifact.kind,
        artifact.title,
        artifact.mime_type,
        artifact.storage_path,
        artifact.sha256_hash,
        artifact.byte_size,
        artifact.compact_digest,
        artifact.version,
        artifact.created_at,
      );

    this.ledger.append({
      roomId: params.roomId ?? "office-global",
      eventType: "artifact.published",
      actorSessionEmployeeId: params.authorSessionId,
      payload: {
        artifact_id: artifact.id,
        pointer: `artifact://${artifact.id}`,
        kind: artifact.kind,
        title: artifact.title,
        byte_size: artifact.byte_size,
        compact_digest: artifact.compact_digest,
      },
    });

    return { artifact, pointer: `artifact://${artifact.id}` };
  }

  public getArtifact(artifactId: string): { artifact: BlackboardArtifact; content: string } | null {
    const cleanId = artifactId.replace(/^artifact:\/\//, "");
    const row = this.db.prepare("SELECT * FROM blackboard_artifacts WHERE id = ?").get(cleanId) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    const artifact = this.mapRow(row);
    const content = existsSync(artifact.storage_path)
      ? readFileSync(artifact.storage_path, "utf8")
      : "";
    return { artifact, content };
  }

  public listArtifacts(filter: { roomId?: string; ticketId?: string } = {}): BlackboardArtifact[] {
    let sql = "SELECT * FROM blackboard_artifacts WHERE 1=1";
    const args: Array<string> = [];
    if (filter.roomId) {
      sql += " AND room_id = ?";
      args.push(filter.roomId);
    }
    if (filter.ticketId) {
      sql += " AND ticket_id = ?";
      args.push(filter.ticketId);
    }
    sql += " ORDER BY created_at DESC";
    const rows = this.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): BlackboardArtifact {
    return BlackboardArtifactSchema.parse({
      id: String(row.id),
      room_id: row.room_id ? String(row.room_id) : null,
      ticket_id: row.ticket_id ? String(row.ticket_id) : null,
      author_session_id: String(row.author_session_id),
      kind: row.kind,
      title: String(row.title),
      mime_type: String(row.mime_type),
      storage_path: String(row.storage_path),
      sha256_hash: String(row.sha256_hash),
      byte_size: Number(row.byte_size),
      compact_digest: String(row.compact_digest),
      version: Number(row.version),
      created_at: String(row.created_at),
    });
  }
}
