import {
  MAX_DELIBERATION_ROUNDS,
  type RoomConfig,
  RoomConfigSchema,
} from "@factory-arena/protocol";

/**
 * Parse a room's stored `config_json`, clamping `max_rounds` into the schema range first.
 * Earlier builds could persist `max_rounds > MAX_DELIBERATION_ROUNDS` when a room was reopened
 * with `extend_max_rounds`; without the clamp every later read of such a room threw.
 */
export function parseStoredRoomConfig(raw: unknown): RoomConfig {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed === "object" && "max_rounds" in parsed) {
    const value = (parsed as { max_rounds: unknown }).max_rounds;
    if (typeof value === "number" && value > MAX_DELIBERATION_ROUNDS) {
      return RoomConfigSchema.parse({ ...parsed, max_rounds: MAX_DELIBERATION_ROUNDS });
    }
  }
  return RoomConfigSchema.parse(parsed);
}
