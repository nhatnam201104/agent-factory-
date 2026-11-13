import * as THREE from "three";

export function buildGlassWarRoom(scene: THREE.Scene): void {
  const roomFloor = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.06, 8.2),
    new THREE.MeshStandardMaterial({ color: 0x12283c, roughness: 0.5 })
  );
  roomFloor.position.set(4.6, 0.03, 0);
  roomFloor.matrixAutoUpdate = false;
  roomFloor.updateMatrix();
  scene.add(roomFloor);

  const glassWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 2.4, 8.2),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.16 })
  );
  glassWall.position.set(1.0, 1.2, 0);
  glassWall.matrixAutoUpdate = false;
  glassWall.updateMatrix();
  scene.add(glassWall);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 0.18, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e3a5f, metalness: 0.25, roughness: 0.45 })
  );
  table.position.set(4.6, 0.82, 0);
  table.matrixAutoUpdate = false;
  table.updateMatrix();
  scene.add(table);

  const directorDesk = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.78, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x3d2e1e })
  );
  directorDesk.position.set(-0.6, 0.39, -5.4);
  directorDesk.matrixAutoUpdate = false;
  directorDesk.updateMatrix();
  scene.add(directorDesk);
}
