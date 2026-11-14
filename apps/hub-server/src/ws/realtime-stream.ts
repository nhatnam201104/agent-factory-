import type { Server as HttpServer } from "node:http";
import type { ArenaCoreContainer } from "@factory-arena/core";
import { WebSocket, WebSocketServer } from "ws";

const LOOPBACK_WS_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Loopback dev origins, or the hub's own host (bundled UI served from a LAN bind). */
function isTrustedWsOrigin(origin: string, host: string | undefined): boolean {
  if (LOOPBACK_WS_ORIGIN_RE.test(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachRealtimeWebSocket(
  httpServer: HttpServer,
  core: ArenaCoreContainer,
  apiToken?: string,
): { wss: WebSocketServer; close: () => void } {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const origin = req.headers.origin;
    if (origin && !isTrustedWsOrigin(origin.trim(), req.headers.host)) {
      socket.close(1008, "Cross-origin WebSocket connection prohibited");
      return;
    }

    if (apiToken) {
      const reqUrl = new URL(req.url ?? "/ws", "http://127.0.0.1");
      const headerToken =
        (req.headers["x-arena-session-token"] as string | undefined) ??
        req.headers.authorization?.replace(/^Bearer\s+/i, "");
      const queryToken = reqUrl.searchParams.get("token") ?? undefined;
      if ((headerToken ?? queryToken) !== apiToken) {
        socket.close(1008, "Unauthorized WebSocket session");
        return;
      }
    }

    socket.send(
      JSON.stringify({
        type: "snapshot",
        employees: core.roster.listEmployees(),
        pending_permissions: core.roster.listPendingPermissions(),
        tickets: core.kanban.listTickets(),
        rooms: core.council.listRooms(),
      }),
    );
  });

  const unsubscribe = core.ledger.subscribe((event) => {
    if (event.visibility === "sealed_author_only") {
      const redacted = {
        ...event,
        actor_session_employee_id: "sealed",
        payload: { submission_id: event.payload.submission_id, sealed: true },
      };
      const raw = JSON.stringify({ type: "ledger_event", event: redacted });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(raw);
        }
      }
      return;
    }

    const projected = core.ledger.projectEventForViewer(event);
    if (!projected) return;
    const raw = JSON.stringify({ type: "ledger_event", event: projected });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  });

  return {
    wss,
    close: () => {
      unsubscribe();
      wss.close();
    },
  };
}
