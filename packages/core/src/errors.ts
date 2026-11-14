export type ArenaClientErrorStatus = 400 | 403 | 404 | 409;

/**
 * A request the hub refuses for a reason the caller can fix (bad input, forbidden action,
 * stale state). HTTP layers map it to its `status` instead of a generic 500.
 */
export class ArenaClientError extends Error {
  constructor(
    message: string,
    public readonly status: ArenaClientErrorStatus,
  ) {
    super(message);
    this.name = "ArenaClientError";
  }
}
