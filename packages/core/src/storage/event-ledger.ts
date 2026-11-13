import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LedgerEventEnvelopeSchema,
  type LedgerEventEnvelope,
  type LedgerEventType,
  type TokenAccounting,
  type VisibilityScope,
  isoNow,
  prefixedUlid
} from "@factory-arena/protocol";
import type { SecretScrubber } from "../security/secret-scrubber.js";

export type LedgerSubscriber = (event: LedgerEventEnvelope) => void;

export class EventLedger {
  private readonly sequences = new Map<string, number>();
  private readonly subscribers = new Set<LedgerSubscriber>();

  constructor(
    private readonly eventsDir: string,
    private readonly scrubber: SecretScrubber
  ) {
    mkdirSync(this.eventsDir, { recursive: true });
  }

  private roomFilePath(roomId: string): string {
    const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.eventsDir, `${safeRoom}.jsonl`);
  }

  private nextSequence(roomId: string): number {
    if (!this.sequences.has(roomId)) {
      const existing = this.readEvents(roomId);
      const maxSeq = existing.reduce((m, e) => Math.max(m, e.sequence_no), 0);
      this.sequences.set(roomId, maxSeq);
    }
    const next = (this.sequences.get(roomId) ?? 0) + 1;
    this.sequences.set(roomId, next);
    return next;
  }

  public append(params: {
    roomId: string;
    eventType: LedgerEventType;
    actorSessionEmployeeId?: string;
    visibility?: VisibilityScope;
    tokenAccounting?: TokenAccounting;
    payload: Record<string, unknown>;
  }): LedgerEventEnvelope {
    const scrubbedPayload = this.scrubber.scrubUnknown(params.payload);
    const envelope: LedgerEventEnvelope = LedgerEventEnvelopeSchema.parse({
      event_id: prefixedUlid("evt"),
      room_id: params.roomId,
      sequence_no: this.nextSequence(params.roomId),
      timestamp: isoNow(),
      actor_session_employee_id: params.actorSessionEmployeeId,
      visibility: params.visibility ?? "public_room",
      event_type: params.eventType,
      token_accounting: params.tokenAccounting,
      payload: scrubbedPayload
    });

    appendFileSync(this.roomFilePath(params.roomId), `${JSON.stringify(envelope)}\n`, "utf8");

    for (const sub of this.subscribers) {
      sub(envelope);
    }
    return envelope;
  }

  public readEvents(roomId: string, viewerSessionEmployeeId?: string): LedgerEventEnvelope[] {
    const path = this.roomFilePath(roomId);
    if (!existsSync(path)) {
      return [];
    }
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const parsed = lines.map((line) => LedgerEventEnvelopeSchema.parse(JSON.parse(line)));
    if (!viewerSessionEmployeeId) {
      return parsed;
    }

    return parsed
      .filter((ev) => {
        if (ev.visibility === "sealed_author_only") {
          return ev.actor_session_employee_id === viewerSessionEmployeeId;
        }
        return true;
      })
      .map((ev) => {
        if (ev.visibility === "anonymized_peers") {
          const clonedPayload = { ...ev.payload };
          delete clonedPayload.session_employee_id;
          delete clonedPayload.model_identifier;
          delete clonedPayload.employee_code;
          return {
            ...ev,
            actor_session_employee_id: "anonymous",
            payload: clonedPayload
          };
        }
        return ev;
      });
  }

  public subscribe(listener: LedgerSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
}
