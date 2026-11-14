import * as THREE from "three";
import { FLOOR, KANBAN_BOARD_CENTER, LOUNGE_CENTER } from "./layout.js";
import { type MeshKit, createPlant, freezeStatic } from "./meshKit.js";

const WALL_HEIGHT = 3.2;
const WALL_THICKNESS = 0.25;
const COLORS = {
  plankBase: "#d9b48f",
  plankSeam: "rgba(120, 82, 52, 0.28)",
  diorama: 0x8c6a52,
  wall: 0xf3e9dc,
  baseboard: 0xd6c3a8,
  frame: 0xfffaf2,
  oak: 0xe6cfa9,
  walnut: 0x8b5e3c,
  cork: 0xc9a27a,
  sofa: 0x8fa9cf,
  cushion: 0xa9bfdf,
  rugLounge: 0xeccfae,
  lampGlow: 0xffd9a0,
  counter: 0xf6f1ea,
  machine: 0x3d4252,
} as const;
const STICKY_COLORS = [0xffe08a, 0xffb4a8, 0xb5e3c4, 0xb8d4ff, 0xe3c6ff];

/** Builds the static cozy-office shell: floor, cut-away walls, windows and furniture. */
export function buildOfficeEnvironment(scene: THREE.Scene, kit: MeshKit): void {
  const root = new THREE.Group();
  root.name = "office-environment";

  root.add(buildFloor(kit));
  root.add(buildWalls(kit));
  root.add(buildKanbanBoard(kit));
  root.add(buildDirectorCorner(kit));
  root.add(buildLounge(kit));
  root.add(buildCoffeeCorner(kit));

  const plantSpots: Array<[number, number, number]> = [
    [-9.35, -6.45, 1.3],
    [-0.4, -6.45, 1.1],
    [9.3, -6.45, 1.35],
    [9.3, 2.6, 1.0],
    [0.4, 6.3, 0.9],
    [-9.4, 2.6, 1.0],
  ];
  for (const [x, z, s] of plantSpots) {
    const plant = createPlant(kit, s);
    plant.position.set(x, 0, z);
    root.add(plant);
  }

  freezeStatic(root);
  scene.add(root);
}

function buildFloor(kit: MeshKit): THREE.Group {
  const group = new THREE.Group();
  const base = kit.mesh(
    new THREE.BoxGeometry(FLOOR.width + 0.4, 0.6, FLOOR.depth + 0.4),
    COLORS.diorama,
    [0, -0.42, 0],
    { castShadow: false },
  );
  group.add(base);

  const plankTexture = createPlankTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: plankTexture, roughness: 0.82 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(FLOOR.width, 0.12, FLOOR.depth), floorMat);
  floor.position.y = -0.06;
  floor.receiveShadow = true;
  group.add(floor);
  return group;
}

function buildWalls(kit: MeshKit): THREE.Group {
  const group = new THREE.Group();
  const halfW = FLOOR.width / 2;
  const halfD = FLOOR.depth / 2;

  group.add(
    kit.mesh(new THREE.BoxGeometry(FLOOR.width, WALL_HEIGHT, WALL_THICKNESS), COLORS.wall, [
      0,
      WALL_HEIGHT / 2,
      -halfD - WALL_THICKNESS / 2,
    ]),
    kit.mesh(
      new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, FLOOR.depth + WALL_THICKNESS),
      COLORS.wall,
      [-halfW - WALL_THICKNESS / 2, WALL_HEIGHT / 2, -WALL_THICKNESS / 2],
    ),
    kit.mesh(new THREE.BoxGeometry(FLOOR.width, 0.16, 0.06), COLORS.baseboard, [
      0,
      0.08,
      -halfD + 0.03,
    ]),
    kit.mesh(new THREE.BoxGeometry(0.06, 0.16, FLOOR.depth), COLORS.baseboard, [
      -halfW + 0.03,
      0.08,
      0,
    ]),
  );

  const skyTexture = createSkyTexture();
  const paneMat = new THREE.MeshBasicMaterial({ map: skyTexture });
  for (const x of [-3.2, 1.6, 6.4]) {
    group.add(buildWindow(kit, paneMat, 2.3, 1.6, [x, 1.75, -halfD + 0.02], 0));
  }
  group.add(buildWindow(kit, paneMat, 2.6, 1.6, [-halfW + 0.02, 1.75, 3.2], Math.PI / 2));

  const posterColors = [0xf4b6a6, 0xa7c8e8, 0xc9e2b3];
  posterColors.forEach((color, i) => {
    const poster = kit.mesh(new THREE.BoxGeometry(0.04, 0.7, 0.5), color, [
      -halfW + 0.05,
      1.9 - (i % 2) * 0.25,
      -3.4 + i * 0.75,
    ]);
    group.add(poster);
  });
  return group;
}

function buildWindow(
  kit: MeshKit,
  paneMat: THREE.Material,
  width: number,
  height: number,
  position: readonly [number, number, number],
  rotationY: number,
): THREE.Group {
  const win = new THREE.Group();
  win.add(
    kit.mesh(new THREE.BoxGeometry(width + 0.16, height + 0.16, 0.08), COLORS.frame, [0, 0, 0]),
  );
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), paneMat);
  pane.position.z = 0.045;
  win.add(pane);
  win.add(
    kit.mesh(new THREE.BoxGeometry(0.05, height, 0.04), COLORS.frame, [0, 0, 0.06]),
    kit.mesh(new THREE.BoxGeometry(width, 0.05, 0.04), COLORS.frame, [0, 0, 0.06]),
    kit.mesh(new THREE.BoxGeometry(width + 0.3, 0.06, 0.2), COLORS.frame, [
      0,
      -height / 2 - 0.1,
      0.1,
    ]),
  );
  win.position.set(position[0], position[1], position[2]);
  win.rotation.y = rotationY;
  return win;
}

function buildKanbanBoard(kit: MeshKit): THREE.Group {
  const board = new THREE.Group();
  board.add(kit.mesh(new THREE.BoxGeometry(3.0, 1.5, 0.06), COLORS.cork, [0, 0, 0]));
  board.add(kit.mesh(new THREE.BoxGeometry(3.12, 0.06, 0.1), COLORS.walnut, [0, 0.78, 0.02]));
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) {
      if ((col + row) % 3 === 2) continue;
      const color = STICKY_COLORS[(col * 3 + row) % STICKY_COLORS.length] ?? 0xffe08a;
      const note = kit.mesh(new THREE.BoxGeometry(0.42, 0.32, 0.02), color, [
        -1.08 + col * 0.72,
        0.42 - row * 0.42,
        0.045,
      ]);
      note.rotation.z = ((col * 7 + row * 3) % 5) * 0.025 - 0.05;
      board.add(note);
    }
  }
  board.position.set(KANBAN_BOARD_CENTER.x, 1.65, KANBAN_BOARD_CENTER.z + 0.05);
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
  corner.position.set(-3.4, 0, -5.7);
  return corner;
}

function buildLounge(kit: MeshKit): THREE.Group {
  const lounge = new THREE.Group();
  lounge.add(
    kit.mesh(new THREE.BoxGeometry(4.2, 0.02, 2.4), COLORS.rugLounge, [0, 0.012, 0], {
      castShadow: false,
    }),
    kit.mesh(new THREE.BoxGeometry(3.4, 0.42, 0.9), COLORS.sofa, [0, 0.21, 0.55]),
    kit.mesh(new THREE.BoxGeometry(3.4, 0.62, 0.26), COLORS.sofa, [0, 0.62, 0.92]),
    kit.mesh(new THREE.BoxGeometry(0.26, 0.6, 0.9), COLORS.sofa, [-1.7, 0.3, 0.55]),
    kit.mesh(new THREE.BoxGeometry(0.26, 0.6, 0.9), COLORS.sofa, [1.7, 0.3, 0.55]),
  );
  for (const x of [-1.05, 0, 1.05]) {
    lounge.add(kit.mesh(new THREE.BoxGeometry(1.0, 0.12, 0.72), COLORS.cushion, [x, 0.48, 0.5]));
  }
  lounge.add(
    kit.mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), 0x3d4252, [2.3, 0.8, 0.8]),
    kit.mesh(new THREE.ConeGeometry(0.32, 0.36, 16, 1, true), COLORS.lampGlow, [2.3, 1.62, 0.8], {
      emissive: COLORS.lampGlow,
      emissiveIntensity: 0.9,
    }),
    kit.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), 0x3d4252, [2.3, 0.02, 0.8]),
  );
  const plant = createPlant(kit, 0.8, 0x8cc08a);
  plant.position.set(-2.3, 0, 0.8);
  lounge.add(plant);
  lounge.position.set(LOUNGE_CENTER.x, 0, LOUNGE_CENTER.z - 0.4);
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
  corner.position.set(-9.45, 0, 5.4);
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
  texture.repeat.set(5, 3.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "#9fb4e8");
    gradient.addColorStop(0.55, "#f2b8c6");
    gradient.addColorStop(1, "#ffd6a5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
