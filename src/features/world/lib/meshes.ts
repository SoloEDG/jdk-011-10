import * as THREE from "three";
import type { ReliefPlan, WorldDocument } from "../../../shared/document";
import { materials } from "../../../shared/materials";
export function blockMeshes(doc: WorldDocument) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const spec of materials) {
    const blocks = Object.values(doc.blocks).filter(
      (b) => b.material === spec.id,
    );
    if (!blocks.length) continue;
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.9,
        transparent: spec.opacity < 1,
        opacity: spec.opacity,
      }),
      blocks.length,
    );
    const matrix = new THREE.Matrix4();
    blocks.forEach((b, i) => {
      matrix.makeTranslation(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      mesh.setMatrixAt(i, matrix);
      const shade = 0.92 + ((b.x * 13 + b.z * 7 + b.y * 3) % 7) * 0.012;
      mesh.setColorAt(i, new THREE.Color().setScalar(shade));
    });
    mesh.userData.cells = blocks;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
export function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => m.dispose());
    }
  });
}

/** 浮雕预览：计划方块半透明显示，冲突位置标红。 */
export function reliefPreviewMeshes(plan: ReliefPlan) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  for (const spec of materials) {
    const cells = plan.cells.filter((c) => c.material === spec.id);
    if (!cells.length) continue;
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        emissive: spec.color,
        emissiveIntensity: 0.3,
      }),
      cells.length,
    );
    cells.forEach((b, i) => {
      matrix.makeTranslation(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      mesh.setMatrixAt(i, matrix);
    });
    group.add(mesh);
  }
  if (plan.conflicts.length) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: "#cf6a55",
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
      plan.conflicts.length,
    );
    plan.conflicts.forEach((p, i) => {
      matrix.makeTranslation(p.x + 0.5, p.y + 0.5, p.z + 0.5);
      mesh.setMatrixAt(i, matrix);
    });
    group.add(mesh);
  }
  return group;
}
