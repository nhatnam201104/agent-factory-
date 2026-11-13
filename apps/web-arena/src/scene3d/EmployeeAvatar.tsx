import type { SessionEmployee } from "@factory-arena/protocol";
import * as THREE from "three";

export interface AvatarSceneEntry {
  employeeId: string;
  group: THREE.Group;
  rightArm: THREE.Mesh;
  beacon: THREE.Mesh;
  monitorScreen: THREE.Mesh;
  deskPos: { x: number; z: number };
  warRoomPos: { x: number; z: number };
}

const DEPT_COLORS: Record<string, number> = {
  leadership: 0x38f2c8,
  architecture: 0x22d3ee,
  frontend: 0x60a5fa,
  backend: 0xa78bfa,
  security_qa: 0xfb7185,
  devops: 0xfbbf24
};

export function createDeskAndEmployeeAvatar(
  scene: THREE.Scene,
  emp: SessionEmployee,
  index: number
): AvatarSceneEntry {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const deskPos = { x: -6.4 + col * 3.8, z: -3.2 + row * 3.1 };
  const angle = (index / 6) * Math.PI * 2;
  const warRoomPos = {
    x: 4.6 + Math.cos(angle) * 2.25,
    z: Math.sin(angle) * 2.25
  };
  const color = DEPT_COLORS[emp.department] ?? 0x60a5fa;

  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.72, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x1e2b4a })
  );
  desk.position.set(deskPos.x, 0.36, deskPos.z - 0.65);
  desk.matrixAutoUpdate = false;
  desk.updateMatrix();
  scene.add(desk);

  const monitorScreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.46, 0.06),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55
    })
  );
  monitorScreen.position.set(deskPos.x, 0.96, deskPos.z - 0.8);
  scene.add(monitorScreen);

  const group = new THREE.Group();
  group.position.set(deskPos.x, 0, deskPos.z);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.35, 0.84, 14),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.64;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xfde68a })
  );
  head.position.y = 1.3;
  group.add(head);

  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.44, 0.13),
    new THREE.MeshStandardMaterial({ color })
  );
  rightArm.position.set(0.38, 0.88, -0.08);
  group.add(rightArm);

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  );
  beacon.position.y = 1.9;
  beacon.visible = false;
  group.add(beacon);

  scene.add(group);
  return {
    employeeId: emp.id,
    group,
    rightArm,
    beacon,
    monitorScreen,
    deskPos,
    warRoomPos
  };
}
