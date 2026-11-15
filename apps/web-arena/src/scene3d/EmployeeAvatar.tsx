import type { SessionEmployee } from "@factory-arena/protocol";
import * as THREE from "three";
import type { FloorPoint } from "./layout.js";
import { type MeshKit, createPlant, freezeStatic } from "./meshKit.js";
import { createChair } from "./officeEnvironment.js";

export interface AvatarSceneEntry {
  employeeId: string;
  /** Moving character (origin at the feet). */
  group: THREE.Group;
  /** Static desk, laptop and chair that belong to the employee. */
  station: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  statusRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  selectRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Invisible, generous collider used for click / hover picking. */
  hitTarget: THREE.Mesh;
  deskPos: FloorPoint /** Stable per-employee phase offset so animations don't move in lockstep. */;
  seed: number;
}

/** Soft pastel shirt colors per department (also used for the laptop logo). */
export const DEPT_COLORS: Record<SessionEmployee["department"], number> = {
  leadership: 0x5fc9a8,
  architecture: 0x6cb4d9,
  frontend: 0x8aa8ff,
  backend: 0xb59cf0,
  security_qa: 0xf29a9a,
  devops: 0xf4c06b,
};

const SKIN_TONES = [0xf6d2b5, 0xe8b894, 0xc98f6b, 0x9c6b4e, 0xf2c9a0];
const HAIR_COLORS = [0x3b2b25, 0x6b4a32, 0x23232f, 0xc9894a, 0x8a5a7a, 0xe2c27a];
const PANTS_COLORS = [0x4a5068, 0x5b6b7f, 0x6a5a4a];
const CHAIR_COLORS = [0x5b6475, 0x6c7fa3, 0x7a6c8f];
const SEAT_Y = 0.02;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[(seed >>> salt) % list.length] as T;
}

export function createDeskAndEmployeeAvatar(
  scene: THREE.Scene,
  kit: MeshKit,
  emp: SessionEmployee,
  deskPos: FloorPoint,
): AvatarSceneEntry {
  const seed = hashString(emp.id);
  const shirt = DEPT_COLORS[emp.department] ?? 0x8aa8ff;

  const station = buildDeskStation(kit, shirt, seed);
  station.position.set(deskPos.x, 0, deskPos.z);
  freezeStatic(station);
  scene.add(station);

  const group = new THREE.Group();
  group.position.set(deskPos.x, SEAT_Y, deskPos.z);
  group.userData.employeeId = emp.id;

  const pants = pick(PANTS_COLORS, seed, 3);
  const leftLeg = limb(kit, pants, 0.085, 0.2, [-0.11, 0.34, 0]);
  const rightLeg = limb(kit, pants, 0.085, 0.2, [0.11, 0.34, 0]);
  const body = kit.mesh(new THREE.CapsuleGeometry(0.25, 0.3, 6, 16), shirt, [0, 0.66, 0]);
  const leftArm = limb(kit, shirt, 0.075, 0.26, [-0.32, 0.92, 0]);
  const rightArm = limb(kit, shirt, 0.075, 0.26, [0.32, 0.92, 0]);
  const head = buildHead(kit, seed);
  head.position.y = 1.34;

  group.add(leftLeg, rightLeg, body, leftArm, rightArm, head);

  const statusRing = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x7fb8e6, transparent: true, opacity: 0.85 }),
  );
  statusRing.rotation.x = -Math.PI / 2;
  statusRing.position.y = 0.025;

  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.66, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.position.y = 0.03;
  selectRing.visible = false;

  const hitTarget = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 1.9, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  hitTarget.position.y = 0.95;
  hitTarget.userData.employeeId = emp.id;

  group.add(statusRing, selectRing, hitTarget);
  scene.add(group);

  return {
    employeeId: emp.id,
    group,
    station,
    body,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    statusRing,
    selectRing,
    hitTarget,
    deskPos,
    seed: (seed % 1000) / 160,
  };
}

/**
 * Move an already-built desk station to a new floor point (compaction after a
 * removal). The avatar itself keeps walking via its normal placement flow.
 */
export function relocateDesk(entry: AvatarSceneEntry, point: FloorPoint): void {
  entry.deskPos = point;
  entry.station.position.set(point.x, 0, point.z);
  entry.station.updateMatrix();
  entry.station.updateMatrixWorld(true);
}

/** Capsule limb hanging from a pivot so it can swing from the shoulder / hip. */
function limb(
  kit: MeshKit,
  color: number,
  radius: number,
  length: number,
  pivot: readonly [number, number, number],
): THREE.Group {
  const joint = new THREE.Group();
  joint.position.set(pivot[0], pivot[1], pivot[2]);
  joint.add(
    kit.mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), color, [0, -length / 2 - 0.02, 0]),
  );
  return joint;
}

function buildHead(kit: MeshKit, seed: number): THREE.Group {
  const head = new THREE.Group();
  const skin = pick(SKIN_TONES, seed, 5);
  const hair = pick(HAIR_COLORS, seed, 9);

  head.add(kit.mesh(new THREE.SphereGeometry(0.3, 24, 18), skin, [0, 0, 0], { roughness: 0.7 }));

  const hairCap = kit.mesh(
    new THREE.SphereGeometry(0.318, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
    hair,
    [0, 0.01, -0.02],
    { roughness: 0.9 },
  );
  hairCap.rotation.x = -0.32;
  head.add(hairCap);
  if ((seed >>> 13) % 2 === 0) {
    head.add(kit.mesh(new THREE.SphereGeometry(0.11, 12, 10), hair, [0, 0.24, -0.2]));
  }

  const eyeGeo = new THREE.SphereGeometry(0.036, 10, 8);
  const cheekGeo = new THREE.SphereGeometry(0.045, 10, 8);
  for (const side of [-1, 1]) {
    head.add(
      kit.mesh(eyeGeo, 0x2b2b35, [side * 0.1, 0.0, 0.272], { castShadow: false, roughness: 0.3 }),
      kit.mesh(cheekGeo, 0xf4a6a6, [side * 0.17, -0.07, 0.236], { castShadow: false }),
    );
  }
  return head;
}

function buildDeskStation(kit: MeshKit, accent: number, seed: number): THREE.Group {
  const station = new THREE.Group();
  const deskZ = 0.72;

  station.add(
    kit.mesh(new THREE.BoxGeometry(1.6, 0.07, 0.8), 0xe6cfa9, [0, 0.64, deskZ], { roughness: 0.7 }),
    kit.mesh(new THREE.BoxGeometry(0.06, 0.6, 0.72), 0xc9ad85, [-0.74, 0.3, deskZ]),
    kit.mesh(new THREE.BoxGeometry(0.06, 0.6, 0.72), 0xc9ad85, [0.74, 0.3, deskZ]),
    kit.mesh(new THREE.BoxGeometry(0.52, 0.025, 0.34), 0xd4d9e2, [0, 0.69, deskZ - 0.08], {
      metalness: 0.3,
      roughness: 0.4,
    }),
  );

  const lid = new THREE.Group();
  lid.position.set(0, 0.69, deskZ + 0.09);
  lid.rotation.x = 0.28;
  lid.add(
    kit.mesh(new THREE.BoxGeometry(0.52, 0.34, 0.02), 0xd4d9e2, [0, 0.17, 0], {
      metalness: 0.3,
      roughness: 0.4,
    }),
    kit.mesh(new THREE.PlaneGeometry(0.46, 0.28), accent, [0, 0.17, -0.011], {
      emissive: accent,
      emissiveIntensity: 0.65,
      castShadow: false,
    }),
    kit.mesh(new THREE.CircleGeometry(0.035, 16), accent, [0, 0.19, 0.011], {
      emissive: accent,
      emissiveIntensity: 0.9,
      castShadow: false,
    }),
  );
  lid.children[1]?.rotateY(Math.PI);
  station.add(lid);

  if ((seed >>> 7) % 2 === 0) {
    station.add(
      kit.mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 12), 0xf6f1ea, [
        0.55,
        0.725,
        deskZ - 0.05,
      ]),
    );
  } else {
    const succulent = createPlant(kit, 0.35, 0x9fcf9a);
    succulent.position.set(0.58, 0.675, deskZ + 0.15);
    station.add(succulent);
  }

  const chair = createChair(kit, pick(CHAIR_COLORS, seed, 11));
  chair.position.set(0, 0, -0.42);
  station.add(chair);
  return station;
}
