import type { PermissionRequest, SessionEmployee, TaskTicket } from "@factory-arena/protocol";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentActions, AgentQuickPanel } from "./AgentQuickPanel.js";
import { AgentTag } from "./AgentTag.js";
import {
  type AgentActivity,
  currentTicketFor,
  deriveAgentStatus,
  statusStyle,
  workingEmployeeIds,
} from "./agentStatus.js";
import { type SceneRuntime, WebGLUnavailableError, startOfficeScene } from "./sceneRuntime.js";
import "./office-scene.css";

export interface OfficeScene3DProps {
  employees: SessionEmployee[];
  tickets: TaskTicket[];
  pendingPermissions: PermissionRequest[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
  onDropTicketOnEmployee?: (ticketId: string, employeeId: string) => void;
  actions: AgentActions;
}

const LEGEND_ORDER: readonly AgentActivity[] = [
  "working",
  "needs_approval",
  "meeting",
  "idle",
  "offline",
];
const LEGEND = LEGEND_ORDER.map(statusStyle);
/** Panel width + its 12px margin; below the mobile breakpoint the panel docks at the bottom. */
const PANEL_INSET_PX = 342;
const PANEL_DOCKED_BREAKPOINT_PX = 640;

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

export function OfficeScene3D(props: OfficeScene3DProps) {
  const {
    employees,
    tickets,
    pendingPermissions,
    selectedEmployeeId,
    onDropTicketOnEmployee,
    actions,
  } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [tagElements] = useState(() => new Map<string, HTMLElement>());
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [webglFailed, setWebglFailed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const workingIds = workingEmployeeIds(tickets);
  const workingRef = useRef(workingIds);
  workingRef.current = workingIds;

  const openAgent = useCallback((id: string) => {
    latest.current.onSelectEmployee(id);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let runtime: SceneRuntime;
    try {
      runtime = startOfficeScene({
        canvas,
        wrap,
        getEmployees: () => latest.current.employees,
        getPermissions: () => latest.current.pendingPermissions,
        getSelectedId: () => latest.current.selectedEmployeeId,
        getWorkingIds: () => workingRef.current,
        tagElements,
        onPick: openAgent,
        onZoomChange: (relative) => setZoomPct(Math.round(relative * 100)),
      });
    } catch (error: unknown) {
      // Always keep the office usable via the flat roster, but surface real bugs loudly.
      if (!(error instanceof WebGLUnavailableError)) {
        console.error("[OfficeScene3D] failed to build the 3D office", error);
      }
      setWebglFailed(true);
      return;
    }
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [openAgent, tagElements]);

  const pendingIds = new Set(pendingPermissions.map((p) => p.session_employee_id));
  const statuses = new Map(
    employees.map((e) => [e.id, deriveAgentStatus(e, pendingIds, workingIds)]),
  );
  const counts = new Map<AgentActivity, number>();
  for (const s of statuses.values()) counts.set(s.activity, (counts.get(s.activity) ?? 0) + 1);
  const panelEmployee = panelOpen ? employees.find((e) => e.id === selectedEmployeeId) : undefined;
  const hasPanel = Boolean(panelEmployee);

  // Slide the framing left while the panel is open so agents on the right stay reachable.
  useEffect(() => {
    const docked = (wrapRef.current?.clientWidth ?? 0) < PANEL_DOCKED_BREAKPOINT_PX;
    runtimeRef.current?.setRightInset(hasPanel && !docked ? PANEL_INSET_PX : 0);
  }, [hasPanel]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : wrap.requestFullscreen();
    request.catch((error: unknown) => {
      console.error("[OfficeScene3D] fullscreen request was rejected", error);
    });
  };

  return (
    <div
      className={`office-viewport${webglFailed ? " is-flat" : ""}`}
      ref={wrapRef}
      data-testid="office-3d-viewport"
    >
      <canvas
        ref={canvasRef}
        className="office-canvas"
        aria-label="Văn phòng 3D: kéo để xoay, cuộn để zoom, bấm vào nhân viên để xem và giao việc"
      />

      <div className="office-tags">
        {employees.map((emp) => {
          const status = statuses.get(emp.id) ?? deriveAgentStatus(emp, pendingIds);
          return (
            <AgentTag
              key={emp.id}
              employee={emp}
              status={status}
              currentTicket={currentTicketFor(emp, tickets)}
              selected={selectedEmployeeId === emp.id}
              tagRef={(el) => {
                if (el) tagElements.set(emp.id, el);
                else tagElements.delete(emp.id);
              }}
              onSelect={openAgent}
              onDropTicket={onDropTicketOnEmployee}
            />
          );
        })}
      </div>

      <div className="office-hud">
        <span className="office-hud__title">🏡 Studio · {employees.length} agent</span>
        <ul className="office-legend" aria-label="Chú giải trạng thái">
          {LEGEND.map((item) => (
            <li key={item.activity} style={{ "--status": item.css } as CssVars}>
              <span className="office-legend__dot" aria-hidden="true" />
              {item.label}
              <strong>{counts.get(item.activity) ?? 0}</strong>
            </li>
          ))}
        </ul>
      </div>

      {webglFailed ? null : (
        <div className="office-controls">
          <span>Kéo để xoay · Cuộn để zoom · Bấm vào agent để giao việc</span>
          <div className="zoom-group" aria-label="Thu phóng">
            <button
              type="button"
              aria-label="Thu nhỏ"
              data-testid="office-zoom-out"
              onClick={() => runtimeRef.current?.zoomOut()}
            >
              −
            </button>
            <output className="zoom-group__level" data-testid="office-zoom-level">
              {zoomPct}%
            </output>
            <button
              type="button"
              aria-label="Phóng to"
              data-testid="office-zoom-in"
              onClick={() => runtimeRef.current?.zoomIn()}
            >
              +
            </button>
          </div>
          <button type="button" onClick={() => runtimeRef.current?.resetView()}>
            ⟲ Góc nhìn
          </button>
          <button
            type="button"
            data-testid="office-fullscreen"
            aria-pressed={isFullscreen}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? "⤡ Thoát toàn màn hình" : "⛶ Toàn màn hình"}
          </button>
        </div>
      )}

      {panelEmployee ? (
        <AgentQuickPanel
          employee={panelEmployee}
          tickets={tickets}
          pendingPermissions={pendingPermissions}
          actions={actions}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}
