/**
 * Same-origin client for the hub API. When the hub runs with a session token (non-loopback
 * bind or FACTORY_ARENA_API_TOKEN), the operator opens `/?token=…` once; the token is kept in
 * sessionStorage, removed from the address bar, and attached to every request / WebSocket.
 */
const TOKEN_STORAGE_KEY = "factory-arena.session-token";
const TOKEN_QUERY_PARAM = "token";
const TOKEN_HEADER = "X-Arena-Session-Token";

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage can be disabled (privacy mode, sandboxed iframe); fall back to no token.
    return null;
  }
}

/** Move a `?token=` query parameter into session storage and strip it from the URL. */
export function bootstrapSessionToken(): void {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(TOKEN_QUERY_PARAM)?.trim();
  if (!fromUrl) return;
  safeSessionStorage()?.setItem(TOKEN_STORAGE_KEY, fromUrl);
  url.searchParams.delete(TOKEN_QUERY_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function getSessionToken(): string | null {
  return safeSessionStorage()?.getItem(TOKEN_STORAGE_KEY) ?? null;
}

/** `fetch` for hub endpoints that adds the session token header when one is known. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  if (!token) return fetch(path, init);
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  return fetch(path, { ...init, headers });
}

/** WebSocket URL for the realtime stream (token passed as a query parameter). */
export function realtimeUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getSessionToken();
  const query = token ? `?${TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/ws${query}`;
}
