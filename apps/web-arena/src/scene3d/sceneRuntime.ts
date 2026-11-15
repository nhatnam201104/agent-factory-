import type { PermissionRequest, SessionEmployee } from "@factory-arena/protocol";
import * as THREE from "three";
import {
  type AvatarSceneEntry,
  createDeskAndEmployeeAvatar,
  relocateDesk,
} from "./EmployeeAvatar.js";
import { type WarRoomHandle, buildGlassWarRoom } from "./GlassWarRoom.js";
import { deriveAgentStatus } from "./agentStatus.js";
import { planPlacements, updateAvatar, zoneCounts } from "./avatarMotion.js";
import { CAMERA_DISTANCE, type CameraRig, createCameraRig } from "./cameraRig.js";
import { reconcileDeskSlots } from "./deskAssignment.js";
import { type OfficeLayout, type Rect, computeOfficeLayout, deskSlotPosition } from "./layout.js";
import { type MeshKit, createMeshKit, disposeObject } from "./meshKit.js";
import { HAZE, type OfficeEnvironmentHandle, buildOfficeEnvironment } from "./officeEnvironment.js";
import { zoneExtent } from "./zoneSeating.js";

const CLICK_SLOP_PX = 5;
const ACTIVE_FRAME_MS = 1000 / 30;
const HIDDEN_FRAME_MS = 500;
const MAX_DT = 0.1;
const TAG_ANCHOR_Y = 2.0;
const FOG_REACH = 60;
const WHEEL_SENSITIVITY = 0.0018;
const WHEEL_LINE_PX = 16;
const SHADOW_HALF_MAX = 40;
const SHADOW_HALF_PAD = 2;
const TAG_OFFSCREEN_MARGIN = 1.05;

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
  /** Called with the absolute zoom percentage (BASE_ZOOM = 100%) whenever it changes. */
  onZoomChange?: (percent: number) => void;
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
      alpha: false,
      powerPreference: "low-power",
    });
  } catch (error: unknown) {
    throw new WebGLUnavailableError(error);
  }
}

function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

/** Throws {@link WebGLUnavailableError} when WebGL is missing so the caller can fall back to a
 * flat roster; any other error is a genuine bug and is re-thrown after releasing the renderer. */
export function startOfficeScene(inputs: SceneInputs): SceneRuntime {
  const renderer = createRenderer(inputs.canvas);
  try {
    return runOfficeScene(inputs, renderer);
  } catch (error: unknown) {
    renderer.dispose();
    throw error;
  }
}

/** Everything the scene built once: static world, camera rig and layout state. */
interface SceneWorld {
  scene: THREE.Scene;
  kit: MeshKit;
  layout: OfficeLayout;
  occupantCounts: { war_room: number; lounge: number; kanban: number };
  environment: OfficeEnvironmentHandle;
  warRoom: WarRoomHandle;
  rig: CameraRig;
}

const unionRect = (a: Rect, b: Rect): Rect => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minZ: Math.min(a.minZ, b.minZ),
  maxZ: Math.max(a.maxZ, b.maxZ),
});

function footprintKey(fp: Rect): string {
  return `${fp.minX.toFixed(1)}|${fp.maxX.toFixed(1)}|${fp.minZ.toFixed(1)}|${fp.maxZ.toFixed(1)}`;
}

/** Desk footprint plus any zone floors currently grown by occupants (T038). */
function effectiveFootprint(world: SceneWorld): Rect {
  let fp = world.layout.footprint;
  fp = unionRect(fp, zoneExtent(world.layout.zones.war_room, world.occupantCounts.war_room));
  fp = unionRect(fp, zoneExtent(world.layout.zones.lounge, world.occupantCounts.lounge));
  fp = unionRect(fp, zoneExtent(world.layout.zones.kanban, world.occupantCounts.kanban));
  return fp;
}

function footprintRadius(world: SceneWorld): number {
  const fp = world.layout.footprint;
  return Math.max(fp.maxX - fp.minX, fp.maxZ - fp.minZ) / 2;
}

/** Reset the fog band and far plane for the current footprint. */
function applyAtmosphere(world: SceneWorld): void {
  const near = CAMERA_DISTANCE + footprintRadius(world);
  world.scene.fog = new THREE.Fog(HAZE, near, near + FOG_REACH);
  world.rig.camera.far = CAMERA_DISTANCE + 4 * footprintRadius(world) + 80;
  world.rig.camera.updateProjectionMatrix();
}

/** Shadow camera tracks the footprint (capped so shadows stay crisp). */
function applyShadowBounds(world: SceneWorld, sun: THREE.DirectionalLight): void {
  const fp = world.layout.footprint;
  const centerX = (fp.minX + fp.maxX) / 2;
  const centerZ = (fp.minZ + fp.maxZ) / 2;
  const halfW = Math.min((fp.maxX - fp.minX) / 2 + SHADOW_HALF_PAD, SHADOW_HALF_MAX);
  const halfH = Math.min((fp.maxZ - fp.minZ) / 2 + SHADOW_HALF_PAD, SHADOW_HALF_MAX);
  sun.position.set(centerX - 6, 16, centerZ + 9);
  sun.target.position.set(centerX, 0, centerZ);
  sun.target.updateMatrixWorld();
  sun.shadow.camera.left = -halfW;
  sun.shadow.camera.right = halfW;
  sun.shadow.camera.top = halfH;
  sun.shadow.camera.bottom = -halfH;
  sun.shadow.camera.updateProjectionMatrix();
}

function addLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0xb39a82, 1.25));

  const sun = new THREE.DirectionalLight(0xffe2c4, 2.1);
  sun.position.set(-6, 16, 9);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xc7d6ff, 0.55);
  fill.position.set(12, 8, -4);
  scene.add(fill);
  return sun;
}

/** Builds the scene graph, lights, camera rig and their atmosphere wiring. */
function createSceneWorld(inputs: SceneInputs): {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  world: SceneWorld;
} {
  const scene = new THREE.Scene();
  const sun = addLights(scene);
  const kit = createMeshKit();
  const world: SceneWorld = {
    scene,
    kit,
    layout: computeOfficeLayout(0),
    occupantCounts: { war_room: 0, lounge: 0, kanban: 0 },
    environment: null as unknown as OfficeEnvironmentHandle,
    warRoom: null as unknown as WarRoomHandle,
    rig: null as unknown as CameraRig,
  };
  world.environment = buildOfficeEnvironment(scene, kit, world.layout);
  world.warRoom = buildGlassWarRoom(scene, kit, world.layout);
  scene.background = new THREE.Color(HAZE);
  scene.fog = new THREE.Fog(HAZE, 60, 120);

  world.rig = createCameraRig({
    getFootprint: () => effectiveFootprint(world),
    onZoomChange: inputs.onZoomChange,
    onCameraMoved: (focus, extent, distance) => {
      world.environment.followGround(focus.x, focus.z, extent);
      // Fog track follows the (zoom-dependent) camera distance so the nearest
      // ground stays crisp while the horizon still fades into the haze.
      const near = distance * 0.9 + footprintRadius(world) * 0.25;
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = near;
        scene.fog.far = near + FOG_REACH + footprintRadius(world);
      }
      world.rig.camera.far = distance + 4 * footprintRadius(world) + 80;
      world.rig.camera.updateProjectionMatrix();
    },
  });
  return { scene, sun, world };
}

function runOfficeScene(inputs: SceneInputs, renderer: THREE.WebGLRenderer): SceneRuntime {
  const { canvas, wrap } = inputs;
  configureRenderer(renderer);

  const { scene, sun, world } = createSceneWorld(inputs);
  applyAtmosphere(world);
  applyShadowBounds(world, sun);

  const resize = () => {
    const width = Math.max(1, wrap.clientWidth);
    const height = Math.max(1, wrap.clientHeight);
    renderer.setSize(width, height, false);
    world.rig.resize(width, height);
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);

  const entries = new Map<string, AvatarSceneEntry>();
  const pickAt = createPicker({ canvas, camera: world.rig.camera, entries });
  const syncEntries = createRosterSync({
    world,
    entries,
    onKeyChanged: () => applyShadowBounds(world, sun),
  });
  let hoveredId: string | null = null;
  const dragging = { active: false };
  const controls = bindSceneControls(canvas, world.rig, {
    pickAt,
    onHover: (id) => {
      hoveredId = id;
    },
    onPick: inputs.onPick,
    dragging,
  });

  const debugScene =
    import.meta.env.DEV || new URLSearchParams(window.location.search).get("debugScene") === "1";
  const frame = createFrameLoop({
    wrap,
    renderer,
    rig: world.rig,
    inputs,
    world,
    entries,
    debugScene,
    dragging,
    hovered: () => hoveredId,
    syncScene: (employees) => {
      syncEntries(employees);
      syncZoneOccupants(world, employees);
    },
  });
  frame.start();

  return {
    resetView: () => world.rig.resetView(),
    zoomIn: () => world.rig.zoomIn(),
    zoomOut: () => world.rig.zoomOut(),
    setRightInset: (px: number) => world.rig.setRightInset(px),
    dispose: () => {
      frame.stop();
      resizeObserver.disconnect();
      controls.dispose();
      world.rig.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.DirectionalLight) obj.dispose();
      });
      disposeObject(scene);
      entries.clear();
      renderer.dispose();
    },
  };
}

interface ControlDeps {
  pickAt: (clientX: number, clientY: number) => string | null;
  onHover: (employeeId: string | null) => void;
  onPick: (employeeId: string) => void;
  dragging: { active: boolean };
}

/** Pointer drag = orbit, wheel = zoom, click = pick. Returns an unbind function. */
function bindSceneControls(
  canvas: HTMLCanvasElement,
  rig: CameraRig,
  deps: ControlDeps,
): { dispose: () => void } {
  const drag = { active: false, moved: 0, x: 0, y: 0 };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag.active = true;
    drag.moved = 0;
    drag.x = e.clientX;
    drag.y = e.clientY;
    deps.dragging.active = true;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.active) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      rig.orbit(dx, dy);
      return;
    }
    if (e.target !== canvas) return;
    deps.onHover(deps.pickAt(e.clientX, e.clientY));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag.active) return;
    drag.active = false;
    deps.dragging.active = false;
    if (drag.moved > CLICK_SLOP_PX || e.target !== canvas) return;
    const id = deps.pickAt(e.clientX, e.clientY);
    if (id) deps.onPick(id);
  };
  const onPointerLeave = () => deps.onHover(null);
  const onPointerCancel = () => {
    drag.active = false;
    deps.dragging.active = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const deltaPx = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    const rect = canvas.getBoundingClientRect();
    rig.requestZoom(
      rig.zoomTarget() * Math.exp(-deltaPx * WHEEL_SENSITIVITY),
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
      true,
    );
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  return {
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}

function createPicker(deps: {
  canvas: HTMLCanvasElement;
  camera: THREE.OrthographicCamera;
  entries: Map<string, AvatarSceneEntry>;
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  return (clientX: number, clientY: number): string | null => {
    const rect = deps.canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, deps.camera);
    const targets = [...deps.entries.values()].map((e) => e.hitTarget);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const id = hit?.object.userData.employeeId;
    return typeof id === "string" ? id : null;
  };
}

interface RosterSyncDeps {
  world: SceneWorld;
  entries: Map<string, AvatarSceneEntry>;
  onKeyChanged: () => void;
}

/**
 * Adopts the roster incrementally: new agents take desk slots, removals punch
 * holes that compact via {@link relocateDesk}, and the layout re-applies when
 * the desk frame changes. The first sync merely adopts the roster that existed
 * before the scene opened — the camera stays on the default view so small
 * offices open at "100%" (R6) — while the home view refreshes to match.
 */
function createRosterSync(deps: RosterSyncDeps) {
  const { world, entries } = deps;
  let slots = new Map<string, number>();
  let rosterKey = "";
  let initialSyncDone = false;

  return (employees: readonly SessionEmployee[]): void => {
    const ids = employees.map((e) => e.id);
    const key = ids.join("|");
    if (key !== rosterKey) {
      rosterKey = key;
      const { slots: next, moved } = reconcileDeskSlots(slots, ids);
      for (const id of moved) {
        const entry = entries.get(id);
        if (entry) relocateDesk(entry, deskSlotPosition(next.get(id) ?? 0));
      }
      slots = new Map(next);
      const nextLayout = computeOfficeLayout(ids.length);
      const countChanged = nextLayout.desks.count !== world.layout.desks.count;
      const firstSync = !initialSyncDone;
      initialSyncDone = true;
      const keyChanged = nextLayout.key !== world.layout.key;
      if (keyChanged) {
        world.environment.applyLayout(nextLayout);
        applyAtmosphere(world);
        deps.onKeyChanged();
      }
      world.layout = nextLayout;
      if (firstSync) world.rig.refreshHome();
      else if (countChanged) world.rig.onLayoutChanged();
    }
    removeDeadEntries(entries, ids, world.scene);
    for (const emp of employees) {
      if (entries.has(emp.id)) continue;
      entries.set(
        emp.id,
        createDeskAndEmployeeAvatar(
          world.scene,
          world.kit,
          emp,
          deskSlotPosition(slots.get(emp.id) ?? 0),
        ),
      );
    }
  };
}

function removeDeadEntries(
  entries: Map<string, AvatarSceneEntry>,
  liveIds: readonly string[],
  scene: THREE.Scene,
): void {
  const live = new Set(liveIds);
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
  }
}

/** Grow/trim the zone floors when people move between desks and zones (FR-009). */
function syncZoneOccupants(world: SceneWorld, employees: readonly SessionEmployee[]): void {
  const counts = zoneCounts(employees);
  const kinds = ["war_room", "lounge", "kanban"] as const;
  if (kinds.every((kind) => counts[kind] === world.occupantCounts[kind])) return;
  const fpBefore = footprintKey(effectiveFootprint(world));
  for (const kind of kinds) world.occupantCounts[kind] = counts[kind];
  world.environment.setOccupants("lounge", world.occupantCounts.lounge);
  world.environment.setOccupants("kanban", world.occupantCounts.kanban);
  world.warRoom.setOccupants(world.occupantCounts.war_room);
  if (footprintKey(effectiveFootprint(world)) !== fpBefore) world.rig.onLayoutChanged();
}

interface FrameLoopDeps {
  wrap: HTMLElement;
  renderer: THREE.WebGLRenderer;
  rig: CameraRig;
  inputs: SceneInputs;
  world: SceneWorld;
  entries: Map<string, AvatarSceneEntry>;
  debugScene: boolean;
  dragging: { active: boolean };
  hovered: () => string | null;
  syncScene: (employees: readonly SessionEmployee[]) => void;
}

function createFrameLoop(deps: FrameLoopDeps): { start: () => void; stop: () => void } {
  const { wrap, renderer, rig } = deps;
  let frameId = 0;
  let lastMs = 0;
  const clock = new THREE.Clock();

  const tick = (nowMs: number): void => {
    frameId = requestAnimationFrame(tick);
    // Run uncapped while the camera is animating so zoom feels fluid; 30fps otherwise.
    const offscreen = document.hidden || wrap.clientWidth === 0;
    const animating = deps.dragging.active || rig.isAnimating();
    const minDelta = offscreen ? HIDDEN_FRAME_MS : animating ? 0 : ACTIVE_FRAME_MS;
    if (nowMs - lastMs < minDelta) return;
    if (offscreen) {
      lastMs = nowMs;
      return;
    }
    const dt = lastMs === 0 ? 0 : Math.min(MAX_DT, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
    const t = clock.getElapsedTime();
    rig.stepZoom(dt);
    rig.stepFocus(dt);

    const employees = deps.inputs.getEmployees();
    deps.syncScene(employees);
    if (deps.debugScene) logRenderStats(wrap, renderer, deps.entries, deps.world.scene);
    renderAgents(deps, employees, t, dt);
    renderer.render(deps.world.scene, rig.camera);
  };

  return {
    start: () => {
      frameId = requestAnimationFrame(tick);
    },
    stop: () => cancelAnimationFrame(frameId),
  };
}

/** Environment-only geometry count for the `?debugScene=1` overlay (T025). */
function logRenderStats(
  wrap: HTMLElement,
  renderer: THREE.WebGLRenderer,
  entries: Map<string, AvatarSceneEntry>,
  scene: THREE.Scene,
): void {
  const skip = new Set<THREE.Object3D>();
  for (const entry of entries.values()) {
    skip.add(entry.group);
    skip.add(entry.station);
  }
  const seen = new Set<string>();
  let geometryCount = 0;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // traverse() cannot prune subtrees, so check ancestry against the skip set.
    let parent: THREE.Object3D | null = obj.parent;
    while (parent) {
      if (skip.has(parent)) return;
      parent = parent.parent;
    }
    if (!seen.has(mesh.geometry.uuid)) {
      seen.add(mesh.geometry.uuid);
      geometryCount += 1;
    }
  });
  wrap.dataset.geometries = String(geometryCount);
  wrap.dataset.textures = String(renderer.info.memory.textures);
}

const tagProjected = new THREE.Vector3();

function renderAgents(
  deps: FrameLoopDeps,
  employees: readonly SessionEmployee[],
  t: number,
  dt: number,
): void {
  const pendingIds = new Set(deps.inputs.getPermissions().map((p) => p.session_employee_id));
  const selectedId = deps.inputs.getSelectedId();
  const workingIds = deps.inputs.getWorkingIds();
  const hoveredId = deps.hovered();
  const placements = planPlacements(
    employees,
    (id) => deps.entries.get(id)?.deskPos,
    deps.world.layout,
  );

  for (const emp of employees) {
    const entry = deps.entries.get(emp.id);
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
    const tag = deps.inputs.tagElements.get(emp.id);
    if (tag) {
      placeTagAt(tag, entry, deps.rig.camera, deps.wrap, hoveredId);
    }
  }
}

function placeTagAt(
  el: HTMLElement,
  entry: AvatarSceneEntry,
  camera: THREE.OrthographicCamera,
  wrap: HTMLElement,
  hoveredId: string | null,
): void {
  tagProjected.copy(entry.group.position);
  tagProjected.y += TAG_ANCHOR_Y * entry.group.scale.y;
  tagProjected.project(camera);
  if (
    tagProjected.x < -TAG_OFFSCREEN_MARGIN ||
    tagProjected.x > TAG_OFFSCREEN_MARGIN ||
    tagProjected.y < -TAG_OFFSCREEN_MARGIN ||
    tagProjected.y > TAG_OFFSCREEN_MARGIN
  ) {
    el.dataset.offscreen = "true";
  } else {
    delete el.dataset.offscreen;
  }
  const x = (tagProjected.x * 0.5 + 0.5) * wrap.clientWidth;
  const y = (-tagProjected.y * 0.5 + 0.5) * wrap.clientHeight;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  el.style.zIndex = String(Math.round((1 - tagProjected.z) * 1000));
  el.dataset.placed = "true";
  el.classList.toggle("is-hovered", hoveredId === entry.employeeId);
}
