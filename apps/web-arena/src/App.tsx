import type {
  BlackboardArtifact,
  CredentialMetadata,
  Critique,
  DecisionRecord,
  KanbanColumn,
  PermissionRequest,
  SessionEmployee,
  TaskTicket,
  TicketPriority,
  WarRoomMeeting,
  WorkspaceLease,
} from "@factory-arena/protocol";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CritiqueMatrix } from "./council/CritiqueMatrix.js";
import { filterOpenRooms } from "./council/roomStatus.js";
import { ConnectAiModal } from "./inspector/ConnectAiModal.js";
import { DirectorDeskHUD } from "./inspector/DirectorDeskHUD.js";
import {
  type EmployeeCommandRecord,
  EmployeeInspectorDrawer,
} from "./inspector/EmployeeInspectorDrawer.js";
import { KanbanBoard } from "./kanban/KanbanBoard.js";
import {
  type AppTabDef,
  AppTabs,
  TabPanel,
  useHashTab,
  useHeaderHeight,
} from "./layout/AppTabs.js";
import { Office2DRoster } from "./layout/Office2DRoster.js";
import { apiFetch, realtimeUrl } from "./lib/apiClient.js";
import { OfficeScene3D } from "./scene3d/OfficeScene3D.js";

const REFRESH_DEBOUNCE_MS = 200;
const REFRESH_MAX_WAIT_MS = 1000;

function describeSyncFailure(status: number): string {
  if (status === 401) {
    return "Hub yêu cầu token phiên: mở lại trang bằng đường dẫn có ?token=… được in khi khởi động hub.";
  }
  if (status === 403) return "Hub từ chối truy cập từ địa chỉ này (403).";
  return `Không đồng bộ được dữ liệu từ hub (HTTP ${status}).`;
}

type EnrichedRoom = WarRoomMeeting & {
  critiques?: Critique[];
  latest_decision?: DecisionRecord | null;
};

/** Response bodies of the six list endpoints, in the order `refreshAll` requests them. */
type HubSnapshot = [
  { participants?: SessionEmployee[]; pending_permissions?: PermissionRequest[] },
  { tickets?: TaskTicket[]; active_leases?: WorkspaceLease[] },
  { rooms?: EnrichedRoom[] },
  { artifacts?: BlackboardArtifact[] },
  { credentials?: CredentialMetadata[] },
  { commands?: EmployeeCommandRecord[] },
];

export function App() {
  const [employees, setEmployees] = useState<SessionEmployee[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [tickets, setTickets] = useState<TaskTicket[]>([]);
  const [activeLeases, setActiveLeases] = useState<WorkspaceLease[]>([]);
  const [artifacts, setArtifacts] = useState<BlackboardArtifact[]>([]);
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [commandLogs, setCommandLogs] = useState<EmployeeCommandRecord[]>([]);
  const [rooms, setRooms] = useState<EnrichedRoom[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const [connectAiOpen, setConnectAiOpen] = useState(false);
  const [activeTab, setActiveTab] = useHashTab();
  const headerRef = useHeaderHeight<HTMLElement>();

  const [syncError, setSyncError] = useState<string | null>(null);
  const refreshSeq = useRef(0);

  const refreshAll = useCallback(async () => {
    // Responses of overlapping refreshes can arrive out of order; only the newest may win.
    const seq = ++refreshSeq.current;
    const paths = [
      "/api/v1/participants",
      "/api/v1/tickets",
      "/api/v1/rooms",
      "/api/v1/artifacts",
      "/api/v1/vault/credentials",
      "/api/v1/commands/history",
    ];
    let payloads: unknown[];
    try {
      const responses = await Promise.all(paths.map((path) => apiFetch(path)));
      const failed = responses.find((res) => !res.ok);
      if (failed) {
        if (seq === refreshSeq.current) setSyncError(describeSyncFailure(failed.status));
        return;
      }
      payloads = await Promise.all(responses.map((res) => res.json() as Promise<unknown>));
    } catch (error: unknown) {
      if (seq === refreshSeq.current) {
        setSyncError(error instanceof Error ? error.message : "Mất kết nối tới hub");
      }
      return;
    }
    if (seq !== refreshSeq.current) return;
    setSyncError(null);
    const [pJson, tJson, rJson, aJson, vJson, cJson] = payloads as unknown as HubSnapshot;
    setEmployees(pJson.participants ?? []);
    setPendingPermissions(pJson.pending_permissions ?? []);
    setTickets(tJson.tickets ?? []);
    setActiveLeases(tJson.active_leases ?? []);
    setRooms(rJson.rooms ?? []);
    setArtifacts(aJson.artifacts ?? []);
    setCredentials(vJson.credentials ?? []);
    setCommandLogs(cJson.commands ?? []);
    setSelectedEmpId((prev) => prev ?? pJson.participants?.[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refreshAll();
    // Ledger events arrive in bursts (a council run emits dozens); coalesce them into one
    // refresh, but never postpone it longer than REFRESH_MAX_WAIT_MS.
    let timer: number | undefined;
    let firstQueuedAt = 0;
    const scheduleRefresh = () => {
      const now = performance.now();
      if (timer === undefined) firstQueuedAt = now;
      window.clearTimeout(timer);
      const wait = Math.max(
        0,
        Math.min(REFRESH_DEBOUNCE_MS, firstQueuedAt + REFRESH_MAX_WAIT_MS - now),
      );
      timer = window.setTimeout(() => {
        timer = undefined;
        void refreshAll();
      }, wait);
    };
    const ws = new WebSocket(realtimeUrl());
    ws.onmessage = scheduleRefresh;
    return () => {
      window.clearTimeout(timer);
      ws.close();
    };
  }, [refreshAll]);

  const handleResolvePermission = async (permissionId: string, decision: "allowed" | "denied") => {
    await apiFetch(`/api/v1/permissions/${permissionId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, resolved_by: "director_ui" }),
    });
    await refreshAll();
  };

  const handleUpdateTicket = async (
    ticketId: string,
    patch: { assignee_session_id?: string | null; kanban_column?: KanbanColumn },
  ) => {
    await apiFetch(`/api/v1/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    await refreshAll();
  };

  const isSummoningRef = useRef(false);

  /** One glass war room: refuse while a meeting is open or a summon is still in flight. */
  const handleSummonCouncil = async () => {
    if (isSummoningRef.current || filterOpenRooms(rooms).length > 0) return;
    isSummoningRef.current = true;
    try {
      await summonCouncil();
    } finally {
      isSummoningRef.current = false;
    }
  };

  const summonCouncil = async () => {
    if (employees.length < 2) return;
    const ids = employees.slice(0, 3).map((e) => e.id);
    const createRes = await apiFetch("/api/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Hội đồng Thiết kế Cô lập Không gian Mã nguồn",
        problem_statement: "Chọn kiến trúc tối ưu giữa Git Worktree và File Lease Lock",
        linked_ticket_id: tickets[0]?.id ?? null,
        protocol_mode: "council",
        participant_ids: ids,
        moderator_id: ids[0],
      }),
    });
    const created = await createRes.json();
    const roomId = created.room.id;
    const roundId = created.round1.id;

    // Submit 3 blind proposals via MCP JSON-RPC endpoint
    for (let i = 0; i < ids.length; i++) {
      await apiFetch("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i + 1,
          method: "tools/call",
          params: {
            name: "arena_submit_proposal",
            arguments: {
              room_id: roomId,
              round_id: roundId,
              participant_id: ids[i],
              summary: `Đề xuất độc lập #${i + 1}: Kết hợp Git Worktree cho code + Advisory File Lease cho IDE`,
              content_markdown: `Chi tiết phương án kỹ thuật #${i + 1} dẫn chứng packages/core/src/workspace/git-worktree-manager.ts:18`,
              citations: [
                { path: "packages/core/src/workspace/git-worktree-manager.ts", line_start: 18 },
              ],
            },
          },
        }),
      });
    }

    await apiFetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: {
          name: "arena_publish_decision",
          arguments: {
            room_id: roomId,
            moderator_id: ids[0],
            winning_alias: "Proposal A",
            final_plan_markdown:
              "Chốt kiến trúc kép: Cấp Git Worktree cô lập cho từng TaskTicket và bật FileLease TTL 600s cho phiên IDE trực tiếp.",
            adopted_amendments: ["Tự động chạy Ralph Clean Retry khi test fail quá 2 lần"],
            dissent_log: [
              {
                issue: "Git Worktree tốn thêm dung lượng đĩa trên monorepo lớn",
                raised_by_alias: "Proposal B",
                revisit_trigger: "Khi kích thước .factory-arena/worktrees vượt 5GB",
              },
            ],
          },
        },
      }),
    });

    await refreshAll();
  };

  const handleSpawnIdeSession = async () => {
    const nextIdx = employees.length + 1;
    await apiFetch("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `spawn-${nextIdx}`,
        method: "tools/call",
        params: {
          name: "arena_checkin_desk",
          arguments: {
            session_fingerprint: `mcp_bridge:zed-window-${nextIdx}:ZED-0${nextIdx}`,
            employee_code: `ZED-0${nextIdx}`,
            display_name: `Zed IDE #${nextIdx}`,
            department: "architecture",
            job_title: "ACP/MCP Systems Architect",
          },
        },
      }),
    });
    await refreshAll();
  };

  const handleCreateTicket = async (input: {
    title: string;
    assignee_session_id?: string | null;
    priority?: "p0_critical" | "p1_high" | "p2_normal" | "p3_low";
  }) => {
    await apiFetch("/api/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        assignee_session_id: input.assignee_session_id ?? null,
        kanban_column: input.assignee_session_id ? "in_progress" : "backlog",
        priority: input.priority ?? "p1_high",
      }),
    });
    await refreshAll();
  };

  const assertOk = async (res: Response, fallback: string): Promise<void> => {
    if (res.ok) return;
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof body?.error === "string" ? body.error : `${fallback} (HTTP ${res.status})`,
    );
  };

  const handleAssignTicketToAgent = async (ticketId: string, employeeId: string) => {
    const res = await apiFetch(`/api/v1/tickets/${encodeURIComponent(ticketId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignee_session_id: employeeId, kanban_column: "in_progress" }),
    });
    await assertOk(res, "Không giao được phiếu việc");
    await refreshAll();
  };

  const handleCreateTaskForAgent = async (
    employeeId: string,
    title: string,
    priority: TicketPriority,
  ) => {
    const res = await apiFetch("/api/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        assignee_session_id: employeeId,
        kanban_column: "in_progress",
        priority,
      }),
    });
    await assertOk(res, "Không tạo được task");
    await refreshAll();
  };

  const handleSendCommandToAgent = async (employeeId: string, prompt: string) => {
    const res = await apiFetch(`/api/v1/participants/${encodeURIComponent(employeeId)}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, create_ticket: true }),
    });
    await assertOk(res, "Không gửi được lệnh");
    const json = (await res.json()) as { command?: { response_markdown?: unknown } };
    await refreshAll();
    return String(json.command?.response_markdown ?? "Đã gửi lệnh.");
  };

  const handleSendEmployeeCommand = async (employeeId: string, prompt: string) => {
    const res = await apiFetch(`/api/v1/participants/${employeeId}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, create_ticket: true }),
    });
    const json = await res.json();
    await refreshAll();
    setSelectedEmpId(employeeId);
    return String(json.command?.response_markdown ?? "Đã gửi lệnh.");
  };

  const handleDispatchDirectorCommand = async (params: {
    mode: "direct_employee" | "council_debate" | "kanban_backlog";
    prompt: string;
    targetEmployeeId?: string;
  }): Promise<string | undefined> => {
    if (params.mode === "kanban_backlog") {
      await handleCreateTicket({ title: params.prompt, priority: "p1_high" });
      return `✅ Đã tạo phiếu việc mới trong Backlog: "${params.prompt}"`;
    }

    if (params.mode === "council_debate") {
      const res = await apiFetch("/api/v1/rooms/summon-council", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: params.prompt.slice(0, 120),
          problem_statement: params.prompt,
          create_epic_ticket: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        return `⚠️ ${json.error ?? "Không thể triệu tập Hội đồng"}`;
      }
      await refreshAll();
      if (!json.decision && Array.isArray(json.awaiting_participant_ids)) {
        return `⚖️ Đã mở Phòng Họp Kính (Vòng 1 SEALED) và gửi đề bài tới ${json.awaiting_participant_ids.length} phiên IDE/CLI đang kết nối — đang chờ các nhân viên nộp đề xuất độc lập!`;
      }
      return `⚖️ Đã triệu tập Hội đồng Phản biện (${json.decision?.winning_alias ?? "Hoàn tất"}) — Xem Biên bản ở bên dưới hoặc bấm Ký duyệt Human Gate!`;
    }

    const empId = params.targetEmployeeId ?? selectedEmployee?.id ?? employees[0]?.id;
    if (!empId) {
      return "⚠️ Chưa có nhân viên nào trong văn phòng. Hãy bấm '🔌 Kết nối / Cấu hình AI' trước.";
    }
    const reply = await handleSendEmployeeCommand(empId, params.prompt);
    return reply;
  };

  const handleSteerRoom = async (
    roomId: string,
    action: "inject_guidance" | "approve_decision" | "reject_and_reopen" | "abort_room",
    guidance?: string,
  ) => {
    await apiFetch(`/api/v1/rooms/${roomId}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, guidance_markdown: guidance }),
    });
    await refreshAll();
  };

  /** There is one glass war room, so disbanding ends every open meeting (incl. stale ones). */
  const handleDisbandAllRooms = async () => {
    const steer = (roomId: string) =>
      apiFetch(`/api/v1/rooms/${roomId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "abort_room" }),
      });
    await Promise.allSettled(filterOpenRooms(rooms).map((room) => steer(room.id)));
    await refreshAll();
  };

  const selectedEmployee = employees.find((e) => e.id === selectedEmpId) ?? employees[0] ?? null;
  const activeRoom = rooms[0];
  const openRoomCount = filterOpenRooms(rooms).length;
  const openTickets = tickets.filter((t) => t.kanban_column !== "done").length;
  const roomsAwaitingGate = rooms.filter((r) => r.status === "awaiting_human_gate").length;
  const tabs: AppTabDef[] = [
    { id: "office", label: "🏡 Văn phòng" },
    {
      id: "command",
      label: "🎛️ Điều phối",
      badge: pendingPermissions.length,
      alert: pendingPermissions.length > 0,
    },
    { id: "kanban", label: "📋 Kanban", badge: openTickets },
    { id: "council", label: "⚖️ Hội đồng", badge: roomsAwaitingGate, alert: roomsAwaitingGate > 0 },
  ];

  return (
    <div className="app-shell">
      {syncError ? (
        <div className="sync-banner" role="alert" data-testid="sync-error-banner">
          ⚠️ {syncError}
        </div>
      ) : null}
      <header className="app-header" ref={headerRef}>
        <div className="app-title">
          <span className="app-title__mark" aria-hidden="true">
            🏡
          </span>
          <div>
            <h1>Factory Agent Studio</h1>
            <p>
              {employees.length} agent online · {pendingPermissions.length} ✋ chờ duyệt
            </p>
          </div>
        </div>

        <AppTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

        <div className="toolbar">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="btn-open-connect-ai"
            title="Kết nối hoặc cấu hình nhà cung cấp AI"
            onClick={() => setConnectAiOpen(true)}
          >
            🔌 Kết nối AI
          </button>
          <button
            type="button"
            className="btn"
            data-testid="btn-summon-council"
            title={
              openRoomCount > 0
                ? "Đang có phòng họp mở — hãy giải tán trước khi triệu tập lại"
                : "Triệu tập họp phản biện tại phòng họp kính 3D"
            }
            disabled={openRoomCount > 0}
            onClick={handleSummonCouncil}
          >
            ⚖️ Triệu tập họp
          </button>
          {openRoomCount > 0 ? (
            <button
              type="button"
              className="btn"
              data-testid="btn-disband-council"
              title="Kết thúc mọi cuộc họp đang mở và cho mọi người về lại bàn làm việc"
              onClick={() => void handleDisbandAllRooms()}
            >
              🛑 Giải tán họp{openRoomCount > 1 ? ` (${openRoomCount})` : ""}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            data-testid="btn-spawn-session"
            title="Mở thêm một session IDE (+1 nhân viên)"
            onClick={handleSpawnIdeSession}
          >
            ➕ Thêm session
          </button>
          <button
            type="button"
            className="btn"
            data-testid="btn-toggle-2d-3d"
            title="Chuyển giữa văn phòng 3D và danh sách 2D gọn nhẹ"
            onClick={() => setViewMode((m) => (m === "3d" ? "2d" : "3d"))}
          >
            {viewMode === "3d" ? "📋 Xem 2D" : "🧊 Xem 3D"}
          </button>
        </div>
      </header>

      <TabPanel id="office" active={activeTab} className="office-stage">
        {viewMode === "3d" ? (
          <OfficeScene3D
            employees={employees}
            tickets={tickets}
            pendingPermissions={pendingPermissions}
            selectedEmployeeId={selectedEmployee?.id ?? null}
            onSelectEmployee={setSelectedEmpId}
            onDropTicketOnEmployee={(ticketId, employeeId) => {
              void handleUpdateTicket(ticketId, {
                assignee_session_id: employeeId,
                kanban_column: "in_progress",
              });
            }}
            actions={{
              assignTicket: handleAssignTicketToAgent,
              createTask: handleCreateTaskForAgent,
              sendCommand: handleSendCommandToAgent,
              resolvePermission: (id, decision) => {
                void handleResolvePermission(id, decision);
              },
            }}
          />
        ) : (
          <Office2DRoster
            employees={employees}
            selectedEmployeeId={selectedEmployee?.id ?? null}
            onSelect={setSelectedEmpId}
          />
        )}
      </TabPanel>

      <TabPanel id="command" active={activeTab} className="workspace-main">
        <div className="page-heading">
          <h2>Điều phối</h2>
          <p>Ra lệnh cho cả đội, lái phòng họp và soi chi tiết từng phiên AI.</p>
        </div>
        <div className="command-grid">
          <DirectorDeskHUD
            employees={employees}
            selectedEmployeeId={selectedEmployee?.id ?? null}
            rooms={rooms}
            onDispatchCommand={handleDispatchDirectorCommand}
            onSteerRoom={handleSteerRoom}
            onDisbandAll={handleDisbandAllRooms}
          />
          <EmployeeInspectorDrawer
            employee={selectedEmployee}
            tickets={tickets}
            pendingPermissions={pendingPermissions}
            commandLogs={commandLogs}
            onResolvePermission={handleResolvePermission}
            onSendEmployeeCommand={async (empId, prompt) => {
              await handleSendEmployeeCommand(empId, prompt);
            }}
          />
        </div>
      </TabPanel>

      <TabPanel id="kanban" active={activeTab} className="workspace-main">
        <div className="page-heading">
          <h2>Kanban</h2>
          <p>Phiếu việc, worktree và artifact của từng agent.</p>
        </div>
        <KanbanBoard
          tickets={tickets}
          employees={employees}
          leases={activeLeases}
          artifacts={artifacts}
          onCreateTicket={handleCreateTicket}
          onUpdateTicket={handleUpdateTicket}
        />
      </TabPanel>

      <TabPanel id="council" active={activeTab} className="workspace-main">
        <div className="page-heading">
          <h2>Hội đồng phản biện</h2>
          <p>Ma trận phản biện, biên bản quyết định và cổng duyệt của Director.</p>
        </div>
        <CritiqueMatrix
          critiques={activeRoom?.critiques ?? []}
          decision={activeRoom?.latest_decision ?? null}
          roomTitle={activeRoom?.title}
          tickets={tickets}
          onApproveGate={
            activeRoom
              ? () => {
                  void handleSteerRoom(activeRoom.id, "approve_decision");
                }
              : undefined
          }
        />
      </TabPanel>

      <ConnectAiModal
        open={connectAiOpen}
        credentials={credentials}
        employeeCount={employees.length}
        onClose={() => setConnectAiOpen(false)}
        onRecruited={refreshAll}
      />
    </div>
  );
}
