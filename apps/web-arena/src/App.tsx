import type {
  KanbanColumn,
  PermissionRequest,
  SessionEmployee,
  TaskTicket,
  WarRoomMeeting
} from "@factory-arena/protocol";
import React, { useCallback, useEffect, useState } from "react";
import { CritiqueMatrix } from "./council/CritiqueMatrix.js";
import { DirectorDeskHUD } from "./inspector/DirectorDeskHUD.js";
import { EmployeeInspectorDrawer } from "./inspector/EmployeeInspectorDrawer.js";
import { KanbanBoard } from "./kanban/KanbanBoard.js";
import { OfficeScene3D } from "./scene3d/OfficeScene3D.js";

type EnrichedRoom = WarRoomMeeting & {
  critiques?: any[];
  latest_decision?: any;
};

export function App() {
  const [employees, setEmployees] = useState<SessionEmployee[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [tickets, setTickets] = useState<TaskTicket[]>([]);
  const [rooms, setRooms] = useState<EnrichedRoom[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");

  const refreshAll = useCallback(async () => {
    const [pRes, tRes, rRes] = await Promise.all([
      fetch("/api/v1/participants"),
      fetch("/api/v1/tickets"),
      fetch("/api/v1/rooms")
    ]);
    const pJson = await pRes.json();
    const tJson = await tRes.json();
    const rJson = await rRes.json();
    setEmployees(pJson.participants ?? []);
    setPendingPermissions(pJson.pending_permissions ?? []);
    setTickets(tJson.tickets ?? []);
    setRooms(rJson.rooms ?? []);
    setSelectedEmpId((prev) => prev ?? pJson.participants?.[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refreshAll();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = () => {
      void refreshAll();
    };
    return () => ws.close();
  }, [refreshAll]);

  const handleResolvePermission = async (
    permissionId: string,
    decision: "allowed" | "denied"
  ) => {
    await fetch(`/api/v1/permissions/${permissionId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, resolved_by: "director_ui" })
    });
    await refreshAll();
  };

  const handleUpdateTicket = async (
    ticketId: string,
    patch: { assignee_session_id?: string | null; kanban_column?: KanbanColumn }
  ) => {
    await fetch(`/api/v1/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    await refreshAll();
  };

  const handleSummonCouncil = async () => {
    if (employees.length < 2) return;
    const ids = employees.slice(0, 3).map((e) => e.id);
    const createRes = await fetch("/api/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Hội đồng Thiết kế Cô lập Không gian Mã nguồn",
        problem_statement: "Chọn kiến trúc tối ưu giữa Git Worktree và File Lease Lock",
        linked_ticket_id: tickets[0]?.id ?? null,
        protocol_mode: "council",
        participant_ids: ids,
        moderator_id: ids[0]
      })
    });
    const created = await createRes.json();
    const roomId = created.room.id;
    const roundId = created.round1.id;

    // Submit 3 blind proposals via MCP JSON-RPC endpoint
    for (let i = 0; i < ids.length; i++) {
      await fetch("/mcp", {
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
              citations: [{ path: "packages/core/src/workspace/git-worktree-manager.ts", line_start: 18 }]
            }
          }
        })
      });
    }

    await fetch("/mcp", {
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
                revisit_trigger: "Khi kích thước .factory-arena/worktrees vượt 5GB"
              }
            ]
          }
        }
      })
    });

    await refreshAll();
  };

  const handleSpawnIdeSession = async () => {
    const nextIdx = employees.length + 1;
    await fetch("/mcp", {
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
            job_title: "ACP/MCP Systems Architect"
          }
        }
      })
    });
    await refreshAll();
  };

  const handleSteerRoom = async (
    roomId: string,
    action: "inject_guidance" | "approve_decision" | "reject_and_reopen" | "abort_room",
    guidance?: string
  ) => {
    await fetch(`/api/v1/rooms/${roomId}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, guidance_markdown: guidance })
    });
    await refreshAll();
  };

  const selectedEmployee =
    employees.find((e) => e.id === selectedEmpId) ?? employees[0] ?? null;
  const activeRoom = rooms[0];

  return (
    <div>
      <header className="app-header">
        <div className="app-title">
          <h1>🏢 Factory Virtual Office & Multi-Agent Arena</h1>
          <p>
            1 Active AI Session = 1 Nhân viên 3D · {employees.length} Sessions Online ·{" "}
            {pendingPermissions.length} Yêu cầu ✋ Giơ tay
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="btn-summon-council"
            onClick={handleSummonCouncil}
          >
            ⚖️ Triệu tập Họp Phản biện (3D War Room)
          </button>
          <button
            type="button"
            className="btn"
            data-testid="btn-spawn-session"
            onClick={handleSpawnIdeSession}
          >
            ➕ Mở thêm Session IDE (+1 Nhân viên)
          </button>
          <button
            type="button"
            className="btn"
            data-testid="btn-toggle-2d-3d"
            onClick={() => setViewMode((m) => (m === "3d" ? "2d" : "3d"))}
          >
            {viewMode === "3d" ? "📋 Chuyển sang 2D gọn nhẹ" : "🧊 Bật Phòng làm việc 3D"}
          </button>
        </div>
      </header>

      <main className="workspace-main">
        <div className="top-grid">
          <div>
            {viewMode === "3d" ? (
              <OfficeScene3D
                employees={employees}
                pendingPermissions={pendingPermissions}
                selectedEmployeeId={selectedEmployee?.id ?? null}
                onSelectEmployee={setSelectedEmpId}
              />
            ) : (
              <div className="card" data-testid="office-2d-roster">
                <h2>📋 Danh sách Nhân viên Phiên AI (2D Compact Mode)</h2>
                {employees.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => setSelectedEmpId(e.id)}
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer"
                    }}
                  >
                    <strong>{e.display_name}</strong> <code>{e.employee_code}</code> —{" "}
                    {e.spatial_zone} ({e.avatar_pose})
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <EmployeeInspectorDrawer
              employee={selectedEmployee}
              tickets={tickets}
              pendingPermissions={pendingPermissions}
              onResolvePermission={handleResolvePermission}
            />
            <DirectorDeskHUD
              employees={employees}
              rooms={rooms}
              onSteerRoom={handleSteerRoom}
            />
          </div>
        </div>

        <KanbanBoard
          tickets={tickets}
          employees={employees}
          onUpdateTicket={handleUpdateTicket}
        />

        <CritiqueMatrix
          critiques={activeRoom?.critiques ?? []}
          decision={activeRoom?.latest_decision ?? null}
        />
      </main>
    </div>
  );
}
