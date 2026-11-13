import type { Server as HttpServer } from "node:http";
import type { ArenaCoreContainer } from "@factory-arena/core";
import { WebSocket, WebSocketServer } from "ws";

export function attachRealtimeWebSocket(
  httpServer: HttpServer,
  core: ArenaCoreContainer
): { wss: WebSocketServer; close: () => void } {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "snapshot",
        employees: core.roster.listEmployees(),
        pending_permissions: core.roster.listPendingPermissions(),
        tickets: core.kanban.listTickets(),
        rooms: core.council.listRooms()
      })
    );
  });

  const unsubscribe = core.ledger.subscribe((event) => {
    if (event.visibility === "sealed_author_only") {
      // Never broadcast sealed Round-1 proposal content over shared room stream
      const redacted = {
        ...event,
        payload: { submission_id: event.payload.submission_id, sealed: true }
      };
      const raw = JSON.stringify({ type: "ledger_event", event: redacted });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(raw);
        }
      }
      return;
    }

    const raw = JSON.stringify({ type: "ledger_event", event });
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
    }
  };
}
