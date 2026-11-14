import * as THREE from "three";
import { WAR_ROOM_CENTER } from "./layout.js";
import { type MeshKit, createPlant, freezeStatic } from "./meshKit.js";

const GLASS_X = 1.3;
const GLASS_HEIGHT = 2.2;
const PANEL_DEPTH = 3.1;
const DOOR_HALF_GAP = 0.9;

/** Soft glass meeting room with a round oak table where council debates happen. */
export function buildGlassWarRoom(scene: THREE.Scene, kit: MeshKit): void {
  const room = new THREE.Group();
  room.name = "glass-war-room";
  const { x: cx, z: cz } = WAR_ROOM_CENTER;

  room.add(
    kit.mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.02, 48), 0xd9cdea, [cx, 0.012, cz], {
      castShadow: false,
    }),
    kit.mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.022, 48), 0xe6dcf2, [cx, 0.016, cz], {
      castShadow: false,
    }),
    kit.mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.1, 40), 0xe0c09a, [cx, 0.76, cz], {
      roughness: 0.6,
    }),
    kit.mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 12), 0xb89a74, [cx, 0.36, cz]),
    kit.mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.05, 24), 0xb89a74, [cx, 0.03, cz]),
  );

  const centerpiece = createPlant(kit, 0.55, 0x9fcf9a);
  centerpiece.position.set(cx, 0.81, cz);
  room.add(centerpiece);

  const glassOpts = { opacity: 0.22, roughness: 0.1, metalness: 0.1, castShadow: false } as const;
  const panelOffset = DOOR_HALF_GAP + PANEL_DEPTH / 2;
  for (const side of [-1, 1]) {
    room.add(
      kit.mesh(
        new THREE.BoxGeometry(0.05, GLASS_HEIGHT, PANEL_DEPTH),
        0xcfe8ff,
        [GLASS_X, GLASS_HEIGHT / 2, cz + side * panelOffset],
        glassOpts,
      ),
      kit.mesh(new THREE.BoxGeometry(0.09, 0.07, PANEL_DEPTH), 0xa6b3c6, [
        GLASS_X,
        GLASS_HEIGHT,
        cz + side * panelOffset,
      ]),
      kit.mesh(new THREE.BoxGeometry(0.09, 0.05, PANEL_DEPTH), 0xa6b3c6, [
        GLASS_X,
        0.025,
        cz + side * panelOffset,
      ]),
    );
  }

  freezeStatic(room);
  scene.add(room);
}
