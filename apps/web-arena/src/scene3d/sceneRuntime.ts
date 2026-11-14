import type { PermissionRequest, SessionEmployee } from "@factory-arena/protocol";
import * as THREE from "three";
import { type AvatarSceneEntry, createDeskAndEmployeeAvatar } from "./EmployeeAvatar.js";
import { buildGlassWarRoom } from "./GlassWarRoom.js";
import { deriveAgentStatus } from "./agentStatus.js";
import { planPlacements, updateAvatar } from "./avatarMotion.js";
import { createMeshKit, disposeObject } from "./meshKit.js";
import { buildOfficeEnvironment } from "./officeEnvironment.js";

const CAMERA_DISTANCE = 40;
const CAMERA_TARGET = new THREE.Vector3(-1.2, 0.3, -0.2);
const DEFAULT_VIEW = { theta: 0.62, phi: 0.98, zoom: 1.15 } as const;
const PHI_MIN = 0.55;
const PHI_MAX = 1.25;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 3.2;
const ZOOM_WHEEL_SENSITIVITY = 0.0018;
const ZOOM_BUTTON_STEP = 1.35;
/** Higher = snappier zoom easing (per second). */
const ZOOM_EASE = 11;
const FOCUS_EASE = 7;
const WHEEL_LINE_PX = 16;
const FOCUS_BOUNDS = { x: 10, yMin: -4, yMax: 6, z: 8 } as const;
const MIN_HALF_HEIGHT = 7.3;
const HALF_WIDTH_TO_FIT = 12.4;
const CLICK_SLOP_PX = 5;
const ACTIVE_FRAME_MS = 1000 / 30;
const HIDDEN_FRAME_MS = 500;
const MAX_DT = 0.1;
const TAG_ANCHOR_Y = 2.0;

export interface SceneInputs {
  canvas: HTMLCanvasElement;
  wrap: HTMLElement;
  getEmployees: () => readonly SessionEmployee[];
  getPermissions: () => readonly PermissionRequest[];
  getSelectedId: () => string | null;
  /** Employees owning an in-progress ticket (counted as working). */
  getWorkingIds: () => ReadonlySet<string>;
  /** HTML name tags keyed by employee id; positioned every frame. */
  tagElements: ReadonlyMap<string, HTMLElement>;
  onPick: (employeeId: string) => void;
  /** Called with the zoom level (1 = default framing) whenever the user changes it. */
  onZoomChange?: (relativeZoom: number) => void;
}

export interface SceneRuntime {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Shift the framing left so an overlay of `px` width on the right does not hide the scene. */
  setRightInset: (px: number) => void;
  dispose: () => void;
}

/** Thrown only when a WebGL context cannot be created (headless CI, blocked GPU). */
export class WebGLUnavailableError extends Error {
  constructor(cause: unknown) {
    super("WebGL is not available", { cause });
    this.name = "WebGLUnavailableError";
  }
}

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch (error: unknown) {
    throw new WebGLUnavailableError(error);
  }
}

/**
 * Throws {@link WebGLUnavailableError} when WebGL is missing so the caller can fall back to a
 * flat roster; any other error is a genuine bug and is re-thrown after releasing the renderer.
 */
export function startOfficeScene(inputs: SceneInputs): SceneRuntime {
  const renderer = createRenderer(inputs.canvas);
  try {
    return runOfficeScene(inputs, renderer);
  } catch (error: unknown) {
    renderer.dispose();
    throw error;
  }
}

function runOfficeScene(inputs: SceneInputs, renderer: THREE.WebGLRenderer): SceneRuntime {
  const { canvas, wrap } = inputs;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  addLights(scene);
  const kit = createMeshKit();
  buildOfficeEnvironment(scene, kit);
  buildGlassWarRoom(scene, kit);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const view: { theta: number; phi: number; zoom: number } = { ...DEFAULT_VIEW };
  const size = { width: 1, height: 1 };
  /** Point the camera orbits around; panned so zooming keeps the cursor spot fixed. */
  const focus = CAMERA_TARGET.clone();
  let focusGoal: THREE.Vector3 | null = null;
  const zoom = { target: view.zoom, anchorX: 0, anchorY: 0 };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  let rightInset = 0;

  const applyCamera = () => {
    const aspect = size.width / size.height;
    const halfH = Math.max(MIN_HALF_HEIGHT, HALF_WIDTH_TO_FIT / aspect);
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.zoom = view.zoom;
    camera.position.set(
      focus.x + CAMERA_DISTANCE * Math.sin(view.phi) * Math.sin(view.theta),
      focus.y + CAMERA_DISTANCE * Math.cos(view.phi),
      focus.z + CAMERA_DISTANCE * Math.sin(view.phi) * Math.cos(view.theta),
    );
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  /** Default orbit point, nudged right while an overlay covers the right edge. */
  const homeFocus = (atZoom: number): THREE.Vector3 => {
    const home = CAMERA_TARGET.clone();
    if (rightInset === 0) return home;
    const worldPerPx = (camera.right - camera.left) / atZoom / size.width;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    return home.addScaledVector(camRight, (rightInset / 2) * worldPerPx);
  };

  const clampFocus = () => {
    focus.x = THREE.MathUtils.clamp(focus.x, -FOCUS_BOUNDS.x, FOCUS_BOUNDS.x);
    focus.y = THREE.MathUtils.clamp(focus.y, FOCUS_BOUNDS.yMin, FOCUS_BOUNDS.yMax);
    focus.z = THREE.MathUtils.clamp(focus.z, -FOCUS_BOUNDS.z, FOCUS_BOUNDS.z);
  };

  /** Request a new zoom level, anchored at a point in normalized device coords. */
  const requestZoom = (nextTarget: number, anchorX: number, anchorY: number) => {
    zoom.target = THREE.MathUtils.clamp(nextTarget, ZOOM_MIN, ZOOM_MAX);
    zoom.anchorX = anchorX;
    zoom.anchorY = anchorY;
    focusGoal = null;
    inputs.onZoomChange?.(zoom.target / DEFAULT_VIEW.zoom);
  };

  /**
   * Ease zoom toward its target. For an orthographic camera a screen point at NDC n sits
   * n * halfExtent / zoom away from the focus, so panning the focus by
   * n * halfExtent * (1/z0 - 1/z1) keeps whatever is under the cursor in place.
   */
  const stepZoom = (dt: number): boolean => {
    const prev = view.zoom;
    if (Math.abs(zoom.target - prev) < 1e-4) return false;
    const blend = reduceMotion ? 1 : 1 - Math.exp(-ZOOM_EASE * dt);
    let next = prev + (zoom.target - prev) * blend;
    if (Math.abs(zoom.target - next) < 1e-3) next = zoom.target;

    const k = 1 / prev - 1 / next;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    focus.addScaledVector(camRight, zoom.anchorX * camera.right * k);
    focus.addScaledVector(camUp, zoom.anchorY * camera.top * k);
    if (next < prev) {
      // Drift back home while zooming out so the full office re-centres at minimum zoom.
      const homeBlend = (prev - next) / Math.max(1e-3, prev - ZOOM_MIN);
      focus.lerp(homeFocus(next), Math.min(1, homeBlend));
    }
    clampFocus();
    view.zoom = next;
    applyCamera();
    return true;
  };

  const stepFocus = (dt: number): boolean => {
    if (!focusGoal) return false;
    focus.lerp(focusGoal, reduceMotion ? 1 : 1 - Math.exp(-FOCUS_EASE * dt));
    if (focus.distanceToSquared(focusGoal) < 1e-5) {
      focus.copy(focusGoal);
      focusGoal = null;
    }
    applyCamera();
    return true;
  };

  const resize = () => {
    size.width = Math.max(1, wrap.clientWidth);
    size.height = Math.max(1, wrap.clientHeight);
    renderer.setSize(size.width, size.height, false);
    applyCamera();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  const entries = new Map<string, AvatarSceneEntry>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredId: string | null = null;

  const pickAt = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const targets = [...entries.values()].map((e) => e.hitTarget);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const id = hit?.object.userData.employeeId;
    return typeof id === "string" ? id : null;
  };

  const drag = { active: false, moved: 0, x: 0, y: 0 };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag.active = true;
    drag.moved = 0;
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.active) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      view.theta -= dx * 0.006;
      view.phi = THREE.MathUtils.clamp(view.phi - dy * 0.005, PHI_MIN, PHI_MAX);
      applyCamera();
      return;
    }
    if (e.target !== canvas) return;
    hoveredId = pickAt(e.clientX, e.clientY);
    canvas.style.cursor = hoveredId ? "pointer" : "grab";
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag.active) return;
    drag.active = false;
    if (drag.moved > CLICK_SLOP_PX || e.target !== canvas) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id) inputs.onPick(id);
  };
  const onPointerLeave = () => {
    hoveredId = null;
  };
  const onPointerCancel = () => {
    drag.active = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const deltaPx = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    const rect = canvas.getBoundingClientRect();
    requestZoom(
      zoom.target * Math.exp(-deltaPx * ZOOM_WHEEL_SENSITIVITY),
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);

  const deskSlots = new Map<string, number>();
  const nextFreeSlot = () => {
    const used = new Set(deskSlots.values());
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  };

  const syncEntries = (employees: readonly SessionEmployee[]) => {
    const live = new Set(employees.map((e) => e.id));
    for (const [id, entry] of entries) {
      if (live.has(id)) continue;
      scene.remove(entry.group, entry.station);
      // Materials are shared through the mesh kit, so only free per-avatar geometry here.
      disposeObject(entry.group, { materials: false });
      disposeObject(entry.station, { materials: false });
      entry.statusRing.material.dispose();
      entry.selectRing.material.dispose();
      (entry.hitTarget.material as THREE.Material).dispose();
      entries.delete(id);
      deskSlots.delete(id);
    }
    for (const emp of employees) {
      if (entries.has(emp.id)) continue;
      const slot = nextFreeSlot();
      deskSlots.set(emp.id, slot);
      entries.set(emp.id, createDeskAndEmployeeAvatar(scene, kit, emp, slot));
    }
  };

  const projected = new THREE.Vector3();
  const placeTag = (entry: AvatarSceneEntry, el: HTMLElement) => {
    projected.copy(entry.group.position);
    projected.y += TAG_ANCHOR_Y * entry.group.scale.y;
    projected.project(camera);
    const x = (projected.x * 0.5 + 0.5) * size.width;
    const y = (-projected.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    el.style.zIndex = String(Math.round((1 - projected.z) * 1000));
    el.dataset.placed = "true";
    el.classList.toggle("is-hovered", hoveredId === entry.employeeId);
  };

  let frameId = 0;
  let lastMs = 0;
  const clock = new THREE.Clock();
  const tick = (nowMs: number) => {
    frameId = requestAnimationFrame(tick);
    // Run uncapped while the camera is animating so zoom feels fluid; 30fps otherwise.
    const animatingCamera = drag.active || focusGoal !== null || zoom.target !== view.zoom;
    // A hidden browser tab or a hidden app tab (zero-size wrapper) only needs a slow heartbeat.
    const offscreen = document.hidden || wrap.clientWidth === 0;
    const minDelta = offscreen ? HIDDEN_FRAME_MS : animatingCamera ? 0 : ACTIVE_FRAME_MS;
    if (nowMs - lastMs < minDelta) return;
    if (offscreen) {
      lastMs = nowMs;
      return;
    }
    const dt = lastMs === 0 ? 0 : Math.min(MAX_DT, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
    const t = clock.getElapsedTime();
    stepZoom(dt);
    stepFocus(dt);

    const employees = inputs.getEmployees();
    syncEntries(employees);
    const pendingIds = new Set(inputs.getPermissions().map((p) => p.session_employee_id));
    const selectedId = inputs.getSelectedId();
    const workingIds = inputs.getWorkingIds();
    const placements = planPlacements(employees, (id) => entries.get(id)?.deskPos);

    for (const emp of employees) {
      const entry = entries.get(emp.id);
      const placement = placements.get(emp.id);
      if (!entry || !placement) continue;
      const status = deriveAgentStatus(emp, pendingIds, workingIds);
      updateAvatar(
        entry,
        {
          placement,
          activity: status.activity,
          pose: emp.avatar_pose,
          statusHex: status.hex,
          selected: selectedId === emp.id,
          hovered: hoveredId === emp.id,
        },
        t,
        dt,
      );
      const tag = inputs.tagElements.get(emp.id);
      if (tag) placeTag(entry, tag);
    }
    renderer.render(scene, camera);
  };
  frameId = requestAnimationFrame(tick);

  return {
    resetView: () => {
      view.theta = DEFAULT_VIEW.theta;
      view.phi = DEFAULT_VIEW.phi;
      zoom.target = DEFAULT_VIEW.zoom;
      zoom.anchorX = 0;
      zoom.anchorY = 0;
      inputs.onZoomChange?.(1);
      applyCamera();
      focusGoal = homeFocus(DEFAULT_VIEW.zoom);
    },
    setRightInset: (px: number) => {
      const delta = (px - rightInset) / 2;
      rightInset = px;
      if (delta === 0) return;
      const worldPerPx = (camera.right - camera.left) / view.zoom / size.width;
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      focusGoal = (focusGoal ?? focus).clone().addScaledVector(camRight, delta * worldPerPx);
    },
    zoomIn: () => requestZoom(zoom.target * ZOOM_BUTTON_STEP, 0, 0),
    zoomOut: () => requestZoom(zoom.target / ZOOM_BUTTON_STEP, 0, 0),
    dispose: () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      scene.traverse((obj) => {
        if (obj instanceof THREE.DirectionalLight) obj.dispose();
      });
      disposeObject(scene);
      entries.clear();
      renderer.dispose();
    },
  };
}

function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0xb39a82, 1.25));

  const sun = new THREE.DirectionalLight(0xffe2c4, 2.1);
  sun.position.set(-6, 16, 9);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xc7d6ff, 0.55);
  fill.position.set(12, 8, -4);
  scene.add(fill);
}
