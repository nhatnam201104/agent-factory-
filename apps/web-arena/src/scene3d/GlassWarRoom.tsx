import * as THREE from "three";
import type { OfficeLayout } from "./layout.js";
import { type MeshKit, createPlant, freezeStatic } from "./meshKit.js";
import { zoneExtent } from "./zoneSeating.js";

const GLASS_HEIGHT = 2.2;
const PANEL_DEPTH = 3.1;
const DOOR_HALF_GAP = 0.9;
/** Glass wall sits on the +x edge of the zone, facing the desk block. */
const GLASS_OFFSET_X = 3.2;

export interface WarRoomHandle {
  /** Grow/trim the meeting-room floor for `occupants` people (no new geometry). */
  setOccupants: (occupants: number) => void;
}

/** Open glass meeting room around the anchored war-room zone (council debates). */
export function buildGlassWarRoom(
  scene: THREE.Scene,
  kit: MeshKit,
  layout: OfficeLayout,
): WarRoomHandle {
  const room = new THREE.Group();
  room.name = "glass-war-room";
  const anchor = layout.zones.war_room;

  // Extendable wooden floor patch west of the round rug (overflow seating).
  const extFloor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.11, 1),
    new THREE.MeshStandardMaterial({ color: 0xe6cfa9, roughness: 0.82 }),
  );
  extFloor.position.y = -0.055;
  extFloor.receiveShadow = true;
  room.add(extFloor);

  room.add(
    kit.mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.02, 48), 0xd9cdea, [0, 0.012, 0], {
      castShadow: false,
    }),
    kit.mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.022, 48), 0xe6dcf2, [0, 0.016, 0], {
      castShadow: false,
    }),
    kit.mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.1, 40), 0xe0c09a, [0, 0.76, 0], {
      roughness: 0.6,
    }),
    kit.mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 12), 0xb89a74, [0, 0.36, 0]),
    kit.mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.05, 24), 0xb89a74, [0, 0.03, 0]),
  );

  const centerpiece = createPlant(kit, 0.55, 0x9fcf9a);
  centerpiece.position.y = 0.81;
  room.add(centerpiece);

  // Low glass wall on the desk-block side with a door gap in the middle.
  const glassOpts = { opacity: 0.22, roughness: 0.1, metalness: 0.1, castShadow: false } as const;
  const panelOffset = DOOR_HALF_GAP + PANEL_DEPTH / 2;
  for (const side of [-1, 1]) {
    room.add(
      kit.mesh(
        new THREE.BoxGeometry(0.05, GLASS_HEIGHT, PANEL_DEPTH),
        0xcfe8ff,
        [GLASS_OFFSET_X, GLASS_HEIGHT / 2, side * panelOffset],
        glassOpts,
      ),
      kit.mesh(new THREE.BoxGeometry(0.09, 0.07, PANEL_DEPTH), 0xa6b3c6, [
        GLASS_OFFSET_X,
        GLASS_HEIGHT,
        side * panelOffset,
      ]),
      kit.mesh(new THREE.BoxGeometry(0.09, 0.05, PANEL_DEPTH), 0xa6b3c6, [
        GLASS_OFFSET_X,
        0.025,
        side * panelOffset,
      ]),
    );
  }

  room.position.set(anchor.center.x, 0, anchor.center.z);
  freezeStatic(room);
  scene.add(room);

  const baseMinX = anchor.baseBounds.minX - anchor.center.x;
  const stripZ = anchor.baseBounds.maxZ - anchor.baseBounds.minZ;
  const applyOccupants = (occupants: number) => {
    const extent = zoneExtent(anchor, occupants);
    const width = baseMinX - extent.minX;
    extFloor.visible = width > 0.01;
    if (extFloor.visible) {
      extFloor.scale.set(width, 1, stripZ);
      extFloor.position.x = extent.minX + width / 2 - anchor.center.x;
      extFloor.updateMatrix();
    }
  };
  applyOccupants(0);
  return { setOccupants: applyOccupants };
}
