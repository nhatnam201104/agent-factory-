import type { SessionEmployee } from "@factory-arena/protocol";
import type * as THREE from "three";
import type { AvatarSceneEntry } from "./EmployeeAvatar.js";
import type { AgentActivity } from "./agentStatus.js";
import {
  type FloorPoint,
  WAR_ROOM_CENTER,
  kanbanPosition,
  loungePosition,
  warRoomPosition,
} from "./layout.js";

const WALK_SPEED = 3.2;
const ARRIVE_EPSILON = 0.04;
const TURN_RATE = 9;
const POSE_RATE = 10;
const BASE_Y = 0.02;

export interface Placement {
  target: FloorPoint;
  /** Yaw (radians) the avatar settles into after arriving. */
  facing: number;
}

export interface AvatarFrameState {
  placement: Placement;
  activity: AgentActivity;
  pose: SessionEmployee["avatar_pose"];
  statusHex: number;
  selected: boolean;
  hovered: boolean;
}

/** Decide where every employee should stand this frame, grouping shared zones into seats. */
export function planPlacements(
  employees: readonly SessionEmployee[],
  deskOf: (employeeId: string) => FloorPoint | undefined,
): Map<string, Placement> {
  const meeting = employees.filter(
    (e) => e.spatial_zone === "at_war_room_table" || e.spatial_zone === "walking_to_war_room",
  );
  const lounge = employees.filter(
    (e) => e.spatial_zone === "lounge_offline" || e.connection_status === "offline",
  );
  const kanban = employees.filter((e) => e.spatial_zone === "at_kanban_wall");
  const placements = new Map<string, Placement>();

  meeting.forEach((emp, seat) => {
    const target = warRoomPosition(seat, meeting.length);
    const facing = Math.atan2(WAR_ROOM_CENTER.x - target.x, WAR_ROOM_CENTER.z - target.z);
    placements.set(emp.id, { target, facing });
  });
  lounge.forEach((emp, seat) => {
    if (!placements.has(emp.id))
      placements.set(emp.id, { target: loungePosition(seat), facing: 0 });
  });
  kanban.forEach((emp, seat) => {
    if (!placements.has(emp.id)) {
      placements.set(emp.id, { target: kanbanPosition(seat), facing: Math.PI });
    }
  });
  for (const emp of employees) {
    if (placements.has(emp.id)) continue;
    const desk = deskOf(emp.id);
    if (desk) placements.set(emp.id, { target: desk, facing: 0 });
  }
  return placements;
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * Math.min(1, rate * dt);
}

function approachAngle(current: number, target: number, rate: number, dt: number): number {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * Math.min(1, rate * dt);
}

function setRotation(obj: THREE.Object3D, x: number, z: number, dt: number): void {
  obj.rotation.x = approach(obj.rotation.x, x, POSE_RATE, dt);
  obj.rotation.z = approach(obj.rotation.z, z, POSE_RATE, dt);
}

/** Advance one avatar by `dt` seconds: walking, facing, limb pose and status rings. */
export function updateAvatar(
  entry: AvatarSceneEntry,
  state: AvatarFrameState,
  t: number,
  dt: number,
): void {
  const g = entry.group;
  const { target, facing } = state.placement;
  const dx = target.x - g.position.x;
  const dz = target.z - g.position.z;
  const dist = Math.hypot(dx, dz);
  const walking = dist > ARRIVE_EPSILON;

  if (walking) {
    const step = Math.min(dist, WALK_SPEED * dt);
    g.position.x += (dx / dist) * step;
    g.position.z += (dz / dist) * step;
  }
  g.rotation.y = approachAngle(g.rotation.y, walking ? Math.atan2(dx, dz) : facing, TURN_RATE, dt);

  const phase = t * 10 + entry.seed;
  g.position.y = BASE_Y + (walking ? Math.abs(Math.sin(phase)) * 0.07 : 0);
  const legSwing = walking ? Math.sin(phase) * 0.55 : 0;
  setRotation(entry.leftLeg, legSwing, 0, dt);
  setRotation(entry.rightLeg, -legSwing, 0, dt);

  poseUpperBody(entry, state, walking, legSwing, t, dt);
  updateRings(entry, state, t, dt);
}

function poseUpperBody(
  entry: AvatarSceneEntry,
  state: AvatarFrameState,
  walking: boolean,
  legSwing: number,
  t: number,
  dt: number,
): void {
  const s = entry.seed;
  let left = { x: 0, z: -0.1 };
  let right = { x: 0, z: 0.1 };
  let head = { x: 0, y: Math.sin(t * 0.45 + s) * 0.3 };
  let breathe = 1.6;

  if (walking) {
    left = { x: -legSwing * 0.8, z: -0.08 };
    right = { x: legSwing * 0.8, z: 0.08 };
    head = { x: 0, y: 0 };
  } else if (state.activity === "needs_approval") {
    right = { x: 0, z: 2.7 + Math.sin(t * 6 + s) * 0.18 };
    head = { x: -0.12, y: Math.sin(t * 1.2 + s) * 0.15 };
  } else if (state.activity === "working") {
    const speed = state.pose === "reading_files" ? 4 : 15;
    const tap = state.pose === "running_tests" ? 0.02 : 0.09;
    left = { x: -1.15 + Math.sin(t * speed + s) * tap, z: 0.05 };
    right = { x: -1.15 + Math.sin(t * speed + s + Math.PI) * tap, z: -0.05 };
    head = { x: 0.14 + Math.sin(t * 1.4 + s) * 0.03, y: Math.sin(t * 0.3 + s) * 0.08 };
  } else if (state.activity === "meeting") {
    const talking = state.pose === "speaking";
    right = { x: talking ? -0.7 + Math.sin(t * 3 + s) * 0.35 : -0.15, z: 0.12 };
    head = { x: 0, y: Math.sin(t * 0.8 + s) * 0.25 };
  } else if (state.activity === "offline") {
    head = { x: 0.35, y: 0 };
    breathe = 0.8;
  }

  setRotation(entry.leftArm, left.x, left.z, dt);
  setRotation(entry.rightArm, right.x, right.z, dt);
  entry.head.rotation.x = approach(entry.head.rotation.x, head.x, POSE_RATE * 0.5, dt);
  entry.head.rotation.y = approach(entry.head.rotation.y, head.y, POSE_RATE * 0.5, dt);
  entry.body.scale.y = 1 + Math.sin(t * breathe + s) * 0.02;
}

function updateRings(
  entry: AvatarSceneEntry,
  state: AvatarFrameState,
  t: number,
  dt: number,
): void {
  const ring = entry.statusRing;
  ring.material.color.setHex(state.statusHex);
  const urgent = state.activity === "needs_approval";
  ring.material.opacity = urgent ? 0.55 + Math.abs(Math.sin(t * 4)) * 0.45 : 0.85;
  ring.scale.setScalar(urgent ? 1 + Math.abs(Math.sin(t * 4)) * 0.12 : 1);

  const sel = entry.selectRing;
  sel.visible = state.selected || state.hovered;
  sel.material.opacity = state.selected ? 0.95 : 0.45;
  sel.scale.setScalar(state.selected ? 1 + Math.sin(t * 3) * 0.05 : 1);

  const targetScale = state.hovered || state.selected ? 1.08 : 1;
  entry.group.scale.setScalar(approach(entry.group.scale.x, targetScale, 12, dt));
}
