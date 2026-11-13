import type { PermissionRequest, SessionEmployee } from "@factory-arena/protocol";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { type AvatarSceneEntry, createDeskAndEmployeeAvatar } from "./EmployeeAvatar.js";
import { buildGlassWarRoom } from "./GlassWarRoom.js";

export interface OfficeScene3DProps {
  employees: SessionEmployee[];
  pendingPermissions: PermissionRequest[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
}

export function OfficeScene3D({
  employees,
  pendingPermissions,
  selectedEmployeeId,
  onSelectEmployee
}: OfficeScene3DProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const employeesRef = useRef<SessionEmployee[]>(employees);
  const permsRef = useRef<PermissionRequest[]>(pendingPermissions);
  const entriesRef = useRef<Map<string, AvatarSceneEntry>>(new Map());
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [badgeCoords, setBadgeCoords] = useState<
    Record<string, { x: number; y: number }>
  >({});

  employeesRef.current = employees;
  permsRef.current = pendingPermissions;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c18);
    sceneRef.current = scene;

    const width = wrap.clientWidth || 800;
    const height = 470;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 90);
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      // Graceful headless WebGL fallback for CI environments without GPU
      return;
    }

    scene.add(new THREE.AmbientLight(0x9cb8ff, 0.88));
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(10, 18, 12);
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.28, 14),
      new THREE.MeshStandardMaterial({ color: 0x0f182c, roughness: 0.88 })
    );
    floor.position.y = -0.14;
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    scene.add(floor);

    const grid = new THREE.GridHelper(20, 20, 0x263864, 0x172443);
    grid.position.y = 0.01;
    scene.add(grid);

    buildGlassWarRoom(scene);

    let dragging = false;
    let prevX = 0;
    let prevY = 0;
    let theta = 0.5;
    let phi = 0.88;
    let radius = 19.2;

    const syncCamera = () => {
      camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(-0.5, 0.6, 0);
    };
    syncCamera();

    const onDown = (e: PointerEvent) => {
      dragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      theta -= (e.clientX - prevX) * 0.007;
      phi = Math.max(0.38, Math.min(1.32, phi - (e.clientY - prevY) * 0.006));
      prevX = e.clientX;
      prevY = e.clientY;
      syncCamera();
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);

    let animId = 0;
    let lastFrameMs = 0;
    const clock = new THREE.Clock();

    const tick = (nowMs: number) => {
      animId = requestAnimationFrame(tick);
      // Throttle background/hidden tab rendering to <5% idle CPU (T045)
      const minDelta = document.hidden ? 500 : 1000 / 30;
      if (nowMs - lastFrameMs < minDelta) return;
      lastFrameMs = nowMs;

      const t = clock.getElapsedTime();
      const currentEmployees = employeesRef.current;
      const pendingByEmp = new Set(permsRef.current.map((p) => p.session_employee_id));

      currentEmployees.forEach((emp, idx) => {
        if (!entriesRef.current.has(emp.id)) {
          entriesRef.current.set(emp.id, createDeskAndEmployeeAvatar(scene, emp, idx));
        }
      });

      const nextCoords: Record<string, { x: number; y: number }> = {};
      const curWidth = wrap.clientWidth || 800;

      currentEmployees.forEach((emp, idx) => {
        const entry = entriesRef.current.get(emp.id);
        if (!entry) return;
        const inMeeting =
          emp.spatial_zone === "at_war_room_table" || emp.spatial_zone === "walking_to_war_room";
        const target = inMeeting ? entry.warRoomPos : entry.deskPos;

        entry.group.position.x += (target.x - entry.group.position.x) * 0.08;
        entry.group.position.z += (target.z - entry.group.position.z) * 0.08;

        const dist = Math.hypot(
          target.x - entry.group.position.x,
          target.z - entry.group.position.z
        );
        entry.group.position.y = dist > 0.12 ? Math.abs(Math.sin(t * 9 + idx)) * 0.16 : 0;

        const hasHandRaised =
          emp.avatar_pose === "hand_raised" || pendingByEmp.has(emp.id);
        if (hasHandRaised) {
          entry.rightArm.position.y = 1.42 + Math.sin(t * 6) * 0.08;
          entry.beacon.visible = true;
        } else {
          entry.rightArm.position.y =
            0.88 + (emp.avatar_pose === "typing_code" ? Math.sin(t * 13 + idx) * 0.05 : 0);
          entry.beacon.visible = inMeeting;
        }

        const proj = new THREE.Vector3(
          entry.group.position.x,
          entry.group.position.y + 2.1,
          entry.group.position.z
        ).project(camera);
        nextCoords[emp.id] = {
          x: (proj.x * 0.5 + 0.5) * curWidth,
          y: (-proj.y * 0.5 + 0.5) * height
        };
      });

      setBadgeCoords(nextCoords);
      renderer?.render(scene, camera);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      renderer?.dispose();
    };
  }, []);

  const pendingEmpSet = new Set(pendingPermissions.map((p) => p.session_employee_id));

  return (
    <div className="viewport-box" ref={wrapRef} data-testid="office-3d-viewport">
      <canvas ref={canvasRef} style={{ width: "100%", height: 470, display: "block" }} />
      {employees.map((emp) => {
        const pos = badgeCoords[emp.id] ?? { x: 120, y: 80 };
        const handRaised = emp.avatar_pose === "hand_raised" || pendingEmpSet.has(emp.id);
        const icon = handRaised
          ? "✋ Cần duyệt"
          : emp.spatial_zone === "at_war_room_table"
            ? "⚖️ Đang họp"
            : "💻 Tại bàn";
        return (
          <button
            type="button"
            key={emp.id}
            data-testid={`employee-badge-${emp.employee_code}`}
            className={`emp-floating-badge${selectedEmployeeId === emp.id ? " selected" : ""}${
              handRaised ? " hand-raised" : ""
            }`}
            style={{ left: pos.x, top: pos.y }}
            onClick={() => onSelectEmployee(emp.id)}
          >
            <strong>{emp.display_name}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>
              [{emp.employee_code}] {icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}
