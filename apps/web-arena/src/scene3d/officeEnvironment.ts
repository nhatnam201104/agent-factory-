import * as THREE from "three";
import type { OfficeLayout, Rect, ZoneKind } from "./layout.js";
import { type MeshKit, createPlant, freezeStatic } from "./meshKit.js";
import { zoneExtent } from "./zoneSeating.js";

/** Warm haze colour shared by the scene background, fog and the CSS viewport. */
export const HAZE = 0xf1d9cf;
const GROUND_COLOR = 0xdcc8a4;
const CURB_COLOR = 0xcfc4b0;

const COLORS = {
  plankBase: "#d9b48f",
  plankSeam: "rgba(120, 82, 52, 0.28)",
  oak: 0xe6cfa9,
  walnut: 0x8b5e3c,
  cork: 0xc9a27a,
  sofa: 0x8fa9cf,
  cushion: 0xa9bfdf,
  rugLounge: 0xeccfae,
  rugKanban: 0xbcd8c2,
  rugCoffee: 0xe8d3a4,
  rugDirector: 0xd9cdea,
  lampGlow: 0xffd9a0,
  counter: 0xf6f1ea,
  machine: 0x3d4252,
} as const;
const STICKY_COLORS = [0xffe08a, 0xffb4a8, 0xb5e3c4, 0xb8d4ff, 0xe3c6ff];
/** floorRects order from computeOfficeLayout: [north, west, deskBlock]. */
const DESK_FLOOR_INDEX = 2;
const DECOR_POOL = 16;

export interface OfficeEnvironmentHandle {
  /** Resize the desk-block floor for a new layout (scale/repeat only, no new geometry). */
  applyLayout: (layout: OfficeLayout) => void;
  /** Grow/trim the lounge or kanban floor patch for `occupants` people. */
  setOccupants: (kind: "lounge" | "kanban", occupants: number) => void;
  /** Keep the outdoor ground plane centred under the camera focus. */
  followGround: (x: number, z: number, extent: number) => void;
}

/** Builds the open-world environment: outdoor ground, wooden floor patches and zones. */
export function buildOfficeEnvironment(
  scene: THREE.Scene,
  kit: MeshKit,
  layout: OfficeLayout,
): OfficeEnvironmentHandle {
  const root = new THREE.Group();
  root.name = "office-environment";

  const ground = buildGround();
  scene.add(ground);

  const floor = buildWoodFloor(layout);
  root.add(floor.group);

  root.add(buildCurbs(kit, layout.floorRects, [0, 1]));
  root.add(buildZoneFurniture(kit, layout));
  root.add(buildZoneRugs(kit, layout));
  root.add(buildPlanterRing(kit, layout));

  const decor = new THREE.Group();
  const plants: THREE.Group[] = [];
  for (let i = 0; i < DECOR_POOL; i++) {
    const plant = createPlant(kit, 1.0 + (i % 3) * 0.15);
    plants.push(plant);
    decor.add(plant);
  }
  root.add(decor);

  freezeStatic(root);
  scene.add(root);

  const applyDecor = (spots: readonly { x: number; z: number }[]) => {
    plants.forEach((plant, i) => {
      const spot = spots[i];
      plant.visible = Boolean(spot);
      if (spot) plant.position.set(spot.x, 0, spot.z);
      plant.updateMatrix();
    });
  };
  applyDecor(layout.decorSpots);

  const applyDeskFloor = (layoutToApply: OfficeLayout) => {
    const rect = layoutToApply.floorRects[DESK_FLOOR_INDEX];
    if (!rect) return;
    const mesh = floor.deskMesh;
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    mesh.scale.set(width, 1, depth);
    mesh.position.set((rect.minX + rect.maxX) / 2, -0.06, (rect.minZ + rect.maxZ) / 2);
    floor.deskTexture.repeat.set(width / 4, depth / 4);
    mesh.updateMatrix();
    applyDecor(layoutToApply.decorSpots);
  };

  const extFloors: Record<"lounge" | "kanban", { mesh: THREE.Mesh; anchorIndex: 1 | 0 }> = {
    lounge: { mesh: buildExtensionFloor(), anchorIndex: 1 },
    kanban: { mesh: buildExtensionFloor(), anchorIndex: 0 },
  };
  root.add(extFloors.lounge.mesh, extFloors.kanban.mesh);

  const setOccupants = (kind: "lounge" | "kanban", occupants: number) => {
    const anchor = layout.zones[kind];
    const extent = zoneExtent(anchor, occupants);
    const ext = extFloors[kind];
    if (!ext) return;
    const widthAlongGrowth =
      kind === "lounge"
        ? anchor.baseBounds.minX - extent.minX
        : anchor.baseBounds.minZ - extent.minZ;
    ext.mesh.visible = widthAlongGrowth > 0.01;
    if (!ext.mesh.visible) return;
    if (kind === "lounge") {
      ext.mesh.scale.set(widthAlongGrowth, 1, anchor.baseBounds.maxZ - anchor.baseBounds.minZ);
      ext.mesh.position.set(
        extent.minX + widthAlongGrowth / 2,
        -0.055,
        (anchor.baseBounds.minZ + anchor.baseBounds.maxZ) / 2,
      );
    } else {
      ext.mesh.scale.set(anchor.baseBounds.maxX - anchor.baseBounds.minX, 1, widthAlongGrowth);
      ext.mesh.position.set(
        (anchor.baseBounds.minX + anchor.baseBounds.maxX) / 2,
        -0.055,
        extent.minZ + widthAlongGrowth / 2,
      );
    }
    ext.mesh.updateMatrix();
  };

  return {
    applyLayout: applyDeskFloor,
    setOccupants,
    followGround: (x, z, extent) => {
      ground.position.set(x, -0.01, z);
      ground.scale.setScalar(extent);
    },
  };
}

/** Outdoor ground plane following the camera; scaled per frame, never frozen. */
function buildGround(): THREE.Mesh {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  return ground;
}

interface WoodFloor {
  group: THREE.Group;
  deskMesh: THREE.Mesh;
  deskTexture: THREE.CanvasTexture;
}

/** One wood patch per floorRect; unit geometry scaled per rect, own plank repeat. */
function buildWoodFloor(layout: OfficeLayout): WoodFloor {
  const group = new THREE.Group();
  let deskMesh: THREE.Mesh | null = null;
  let deskTexture: THREE.CanvasTexture | null = null;
  for (let index = 0; index < layout.floorRects.length; index++) {
    const rect = layout.floorRects[index];
    if (!rect) continue;
    const texture = createPlankTexture();
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.82 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), material);
    const width = rect.maxX - rect.minX;
    const depth = rect.maxZ - rect.minZ;
    mesh.scale.set(width, 1, depth);
    mesh.position.set((rect.minX + rect.maxX) / 2, -0.06, (rect.minZ + rect.maxZ) / 2);
    texture.repeat.set(width / 4, depth / 4);
    mesh.receiveShadow = true;
    group.add(mesh);
    if (index === DESK_FLOOR_INDEX) {
      deskMesh = mesh;
      deskTexture = texture;
    }
  }
  if (!deskMesh || !deskTexture) throw new Error("layout is missing its desk floor rect");
  return { group, deskMesh, deskTexture };
}

/** Unit wooden patch used for zone overflow floors (scaled in setOccupants). */
function buildExtensionFloor(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.11, 1),
    new THREE.MeshStandardMaterial({ color: COLORS.oak, roughness: 0.82 }),
  );
  mesh.position.y = -0.055;
  mesh.receiveShadow = true;
  mesh.visible = false;
  return mesh;
}

/**
 * Low stone curbs along edges of the given floor rects that face open ground
 * (not another floor rect) — the open-world replacement for walls.
 */
function buildCurbs(
  kit: MeshKit,
  floorRects: readonly Rect[],
  indices: readonly number[],
): THREE.Group {
  const group = new THREE.Group();
  const onFloor = (x: number, z: number): boolean =>
    floorRects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  for (const index of indices) {
    const rect = floorRects[index];
    if (!rect) continue;
    addCurbRun(group, kit, rect, true, rect.minZ, -1, onFloor);
    addCurbRun(group, kit, rect, true, rect.maxZ, 1, onFloor);
    addCurbRun(group, kit, rect, false, rect.minX, -1, onFloor);
    addCurbRun(group, kit, rect, false, rect.maxX, 1, onFloor);
  }
  return group;
}

const CURB_STEP = 0.5;

/** One curb box per maximal run of exposed edge samples along `fixed`. */
function addCurbRun(
  group: THREE.Group,
  kit: MeshKit,
  rect: Rect,
  horizontal: boolean,
  fixed: number,
  outward: -1 | 1,
  onFloor: (x: number, z: number) => boolean,
): void {
  const from = horizontal ? rect.minX : rect.minZ;
  const to = horizontal ? rect.maxX : rect.maxZ;
  const segments = Math.max(1, Math.round((to - from) / CURB_STEP));
  let runStart: number | null = null;
  for (let i = 0; i <= segments; i++) {
    const t = from + i * CURB_STEP;
    const probe = horizontal
      ? { x: t, z: fixed + outward * 0.25 }
      : { x: fixed + outward * 0.25, z: t };
    const exposed = !onFloor(probe.x, probe.z);
    if (exposed && runStart === null) runStart = t;
    if (runStart !== null && (!exposed || i === segments)) {
      const end = exposed ? t : t - CURB_STEP;
      const length = Math.max(0.25, end - runStart);
      const mid = (runStart + end) / 2;
      group.add(
        horizontal
          ? kit.mesh(new THREE.BoxGeometry(length, 0.04, 0.2), CURB_COLOR, [mid, 0.02, fixed], {
              castShadow: false,
            })
          : kit.mesh(new THREE.BoxGeometry(0.2, 0.04, length), CURB_COLOR, [fixed, 0.02, mid], {
              castShadow: false,
            }),
      );
      runStart = null;
    }
  }
}

/** Zone furniture placed once at the static anchors. */
function buildZoneFurniture(kit: MeshKit, layout: OfficeLayout): THREE.Group {
  const group = new THREE.Group();
  const kanban = buildKanbanBoard(kit);
  const director = buildDirectorCorner(kit);
  const lounge = buildLounge(kit);
  const coffee = buildCoffeeCorner(kit);
  kanban.position.set(layout.zones.kanban.center.x, 0, layout.zones.kanban.center.z);
  director.position.set(layout.zones.director.center.x, 0, layout.zones.director.center.z);
  lounge.position.set(layout.zones.lounge.center.x, 0, layout.zones.lounge.center.z);
  coffee.position.set(layout.zones.coffee.center.x, 0, layout.zones.coffee.center.z);
  group.add(kanban, director, lounge, coffee);
  return group;
}

/** Different-coloured rugs make the zones readable without walls (FR-003). */
function buildZoneRugs(kit: MeshKit, layout: OfficeLayout): THREE.Group {
  const group = new THREE.Group();
  const rug = (kind: ZoneKind, w: number, d: number, color: number) => {
    const anchor = layout.zones[kind];
    group.add(
      kit.mesh(new THREE.BoxGeometry(w, 0.02, d), color, [anchor.center.x, 0.01, anchor.center.z], {
        castShadow: false,
      }),
    );
  };
  rug("lounge", 4.2, 4.4, COLORS.rugLounge);
  rug("kanban", 4.4, 1.6, COLORS.rugKanban);
  rug("coffee", 1.3, 2.6, COLORS.rugCoffee);
  rug("director", 2.6, 2.1, COLORS.rugDirector);
  return group;
}

function buildPlanterRing(kit: MeshKit, layout: OfficeLayout): THREE.Group {
  const group = new THREE.Group();
  const planter = (kind: ZoneKind, dx: number, dz: number, scale: number, color?: number) => {
    const anchor = layout.zones[kind];
    const plant = createPlant(kit, scale, color);
    plant.position.set(anchor.center.x + dx, 0, anchor.center.z + dz);
    group.add(plant);
  };
  planter("war_room", -3.1, 3.1, 1.0);
  planter("lounge", 2.2, -1.9, 0.9, 0x8cc08a);
  planter("kanban", 2.4, 0.7, 1.1);
  planter("director", 1.5, 0.9, 0.85);
  planter("coffee", 0.7, -1.4, 0.9);
  return group;
}

/** Kanban standing on walnut feet — no wall to hang on in the open world (T019). */
function buildKanbanBoard(kit: MeshKit): THREE.Group {
  const board = new THREE.Group();
  board.add(
    kit.mesh(new THREE.BoxGeometry(0.12, 0.8, 0.26), COLORS.walnut, [-1.2, 0.4, 0]),
    kit.mesh(new THREE.BoxGeometry(0.12, 0.8, 0.26), COLORS.walnut, [1.2, 0.4, 0]),
    kit.mesh(new THREE.BoxGeometry(3.0, 1.5, 0.06), COLORS.cork, [0, 1.55, 0]),
    kit.mesh(new THREE.BoxGeometry(3.12, 0.06, 0.1), COLORS.walnut, [0, 2.33, 0.02]),
  );
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) {
      if ((col + row) % 3 === 2) continue;
      const color = STICKY_COLORS[(col * 3 + row) % STICKY_COLORS.length] ?? 0xffe08a;
      const note = kit.mesh(new THREE.BoxGeometry(0.42, 0.32, 0.02), color, [
        -1.08 + col * 0.72,
        1.97 - row * 0.42,
        0.045,
      ]);
      note.rotation.z = ((col * 7 + row * 3) % 5) * 0.025 - 0.05;
      board.add(note);
    }
  }
  return board;
}

function buildDirectorCorner(kit: MeshKit): THREE.Group {
  const corner = new THREE.Group();
  corner.add(
    kit.mesh(new THREE.BoxGeometry(2.4, 0.08, 1.05), COLORS.walnut, [0, 0.74, 0]),
    kit.mesh(new THREE.BoxGeometry(2.3, 0.66, 0.06), 0x77502f, [0, 0.36, -0.45]),
    kit.mesh(new THREE.BoxGeometry(0.08, 0.7, 1.0), 0x77502f, [-1.1, 0.35, 0]),
    kit.mesh(new THREE.BoxGeometry(0.08, 0.7, 1.0), 0x77502f, [1.1, 0.35, 0]),
    kit.mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), 0x2f3442, [0, 1.12, -0.3]),
    kit.mesh(new THREE.PlaneGeometry(0.82, 0.47), 0x9fd8ff, [0, 1.12, -0.272], {
      emissive: 0x9fd8ff,
      emissiveIntensity: 0.55,
      castShadow: false,
    }),
    kit.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), 0xf6f1ea, [0.8, 0.81, 0.15]),
  );
  const chair = createChair(kit, 0x4c5a78);
  chair.position.set(0, 0, 0.85);
  chair.rotation.y = Math.PI;
  corner.add(chair);
  return corner;
}

/** Sofa on the west end facing east; overflow seats face it from the east side. */
function buildLounge(kit: MeshKit): THREE.Group {
  const lounge = new THREE.Group();
  lounge.add(
    kit.mesh(new THREE.BoxGeometry(3.4, 0.42, 0.9), COLORS.sofa, [-1.4, 0.21, 0]),
    kit.mesh(new THREE.BoxGeometry(3.4, 0.62, 0.26), COLORS.sofa, [-1.75, 0.62, 0]),
    kit.mesh(new THREE.BoxGeometry(0.26, 0.6, 0.9), COLORS.sofa, [-1.4, 0.3, -0.5]),
    kit.mesh(new THREE.BoxGeometry(0.26, 0.6, 0.9), COLORS.sofa, [-1.4, 0.3, 0.5]),
  );
  for (const z of [-0.5, 0, 0.5]) {
    lounge.add(kit.mesh(new THREE.BoxGeometry(1.0, 0.12, 0.72), COLORS.cushion, [-1.05, 0.48, z]));
  }
  lounge.add(
    kit.mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), 0x3d4252, [1.6, 0.8, 1.6]),
    kit.mesh(new THREE.ConeGeometry(0.32, 0.36, 16, 1, true), COLORS.lampGlow, [1.6, 1.62, 1.6], {
      emissive: COLORS.lampGlow,
      emissiveIntensity: 0.9,
    }),
    kit.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), 0x3d4252, [1.6, 0.02, 1.6]),
  );
  const plant = createPlant(kit, 0.8, 0x8cc08a);
  plant.position.set(1.6, 0, -1.6);
  lounge.add(plant);
  return lounge;
}

function buildCoffeeCorner(kit: MeshKit): THREE.Group {
  const corner = new THREE.Group();
  corner.add(
    kit.mesh(new THREE.BoxGeometry(0.9, 0.86, 2.4), COLORS.counter, [0, 0.43, 0]),
    kit.mesh(new THREE.BoxGeometry(0.98, 0.06, 2.48), COLORS.walnut, [0, 0.89, 0]),
    kit.mesh(new THREE.BoxGeometry(0.42, 0.5, 0.4), COLORS.machine, [0, 1.17, -0.6]),
    kit.mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), 0xff8a65, [0.22, 1.3, -0.6], {
      emissive: 0xff8a65,
      emissiveIntensity: 0.8,
    }),
  );
  const mugColors = [0xf4b6a6, 0xa7c8e8, 0xf6f1ea];
  mugColors.forEach((color, i) => {
    corner.add(
      kit.mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 12), color, [
        0.05,
        0.98,
        0.1 + i * 0.22,
      ]),
    );
  });
  return corner;
}

/** Office chair shared by employee desks and the director corner. */
export function createChair(kit: MeshKit, seatColor: number): THREE.Group {
  const chair = new THREE.Group();
  chair.add(
    kit.mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 16), seatColor, [0, 0.46, 0]),
    kit.mesh(new THREE.BoxGeometry(0.5, 0.48, 0.08), seatColor, [0, 0.78, -0.24]),
    kit.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), 0x3d4252, [0, 0.24, 0]),
    kit.mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 5), 0x3d4252, [0, 0.03, 0]),
  );
  return chair;
}

function createPlankTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = COLORS.plankBase;
    ctx.fillRect(0, 0, size, size);
    const plankH = size / 8;
    for (let i = 0; i < 8; i++) {
      const shade = 0.035 * ((i * 5) % 3) - 0.03;
      ctx.fillStyle = shade >= 0 ? `rgba(255,255,255,${shade})` : `rgba(90,60,30,${-shade})`;
      ctx.fillRect(0, i * plankH, size, plankH);
      ctx.fillStyle = COLORS.plankSeam;
      ctx.fillRect(0, i * plankH, size, 2);
      const seamX = ((i * 97) % size) + (i % 2 ? 40 : 0);
      ctx.fillRect(seamX % size, i * plankH, 2, plankH);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
