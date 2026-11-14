import * as THREE from "three";

export type Vec3 = readonly [number, number, number];

export interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  flat?: boolean;
}

export interface MeshOptions extends MaterialOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface MeshKit {
  material: (color: number, opts?: MaterialOptions) => THREE.MeshStandardMaterial;
  mesh: (
    geometry: THREE.BufferGeometry,
    color: number,
    position: Vec3,
    opts?: MeshOptions,
  ) => THREE.Mesh;
}

/**
 * Small factory that caches materials per scene so the diorama re-uses
 * one material per (color, options) pair instead of hundreds of copies.
 */
export function createMeshKit(): MeshKit {
  const cache = new Map<string, THREE.MeshStandardMaterial>();

  const material = (color: number, opts: MaterialOptions = {}): THREE.MeshStandardMaterial => {
    const key = [
      color,
      opts.roughness,
      opts.metalness,
      opts.emissive,
      opts.emissiveIntensity,
      opts.opacity,
      opts.flat,
    ].join("|");
    const cached = cache.get(key);
    if (cached) return cached;
    const opacity = opts.opacity ?? 1;
    const created = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      flatShading: opts.flat ?? false,
    });
    cache.set(key, created);
    return created;
  };

  const mesh = (
    geometry: THREE.BufferGeometry,
    color: number,
    position: Vec3,
    opts: MeshOptions = {},
  ): THREE.Mesh => {
    const created = new THREE.Mesh(geometry, material(color, opts));
    created.position.set(position[0], position[1], position[2]);
    created.castShadow = opts.castShadow ?? true;
    created.receiveShadow = opts.receiveShadow ?? true;
    return created;
  };

  return { material, mesh };
}

/** Bake transforms of a static subtree so three.js skips per-frame matrix updates. */
export function freezeStatic(root: THREE.Object3D): void {
  root.traverse((obj) => {
    obj.updateMatrix();
    obj.matrixAutoUpdate = false;
  });
  root.updateMatrixWorld(true);
}

/** Release GPU resources owned by a subtree. Safe to call on shared materials. */
export function disposeObject(root: THREE.Object3D, opts: { materials?: boolean } = {}): void {
  const disposeMaterials = opts.materials ?? true;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    if (!disposeMaterials) return;
    const materials: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if ("map" in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
      mat.dispose();
    }
  });
}

/** Low-poly potted plant used to dress the office. */
export function createPlant(kit: MeshKit, scale = 1, leafColor = 0x7fb27f): THREE.Group {
  const plant = new THREE.Group();
  plant.add(
    kit.mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.36, 10), 0xd98b64, [0, 0.18, 0], {
      roughness: 0.9,
    }),
  );
  const leaves: Array<[number, number, number, number]> = [
    [0, 0.62, 0, 0.32],
    [0.14, 0.82, 0.06, 0.22],
    [-0.12, 0.78, -0.08, 0.24],
  ];
  leaves.forEach(([x, y, z, r], i) => {
    plant.add(
      kit.mesh(new THREE.IcosahedronGeometry(r, 0), i === 1 ? 0x5f9e6e : leafColor, [x, y, z], {
        flat: true,
        roughness: 0.75,
      }),
    );
  });
  plant.scale.setScalar(scale);
  return plant;
}
