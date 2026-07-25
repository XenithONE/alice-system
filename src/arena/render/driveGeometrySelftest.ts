import * as THREE from "three";
import { PARTS } from "../parts/catalog";
import { CELL, type DriveDef } from "../sim/types";
import { createTrack, trackWheelMatrixScratch } from "./procedural/track";
import { createTyre } from "./procedural/tyre";

declare const process: { exitCode?: number };

interface Bounds {
  readonly box: THREE.Box3;
  readonly finite: boolean;
}

function objectBounds(root: THREE.Object3D): Bounds {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let finite = true;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      finite &&= Number.isFinite(position.getX(index)) &&
        Number.isFinite(position.getY(index)) &&
        Number.isFinite(position.getZ(index));
    }
    for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) {
      const values = attribute.array;
      for (let index = 0; index < values.length; index += 1) {
        if (!Number.isFinite(values[index]!)) finite = false;
      }
    }
    object.geometry.computeBoundingBox();
    const geometryBox = object.geometry.boundingBox!.clone();
    if (object instanceof THREE.InstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        const instance = new THREE.Matrix4();
        object.getMatrixAt(index, instance);
        box.union(geometryBox.clone().applyMatrix4(instance).applyMatrix4(object.matrixWorld));
      }
    } else {
      box.union(geometryBox.applyMatrix4(object.matrixWorld));
    }
  });
  return { box, finite };
}

function beltNormalStats(root: THREE.Object3D): { plusX: number; bottomY: number } | null {
  let belt: THREE.BufferGeometry | undefined;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.name.startsWith("track-belt:")) {
      belt = object.geometry;
    }
  });
  const measuredBelt = belt as THREE.BufferGeometry | undefined;
  if (!measuredBelt) return null;
  const position = measuredBelt.getAttribute("position");
  const normal = measuredBelt.getAttribute("normal");
  const indices = Array.from({ length: position.count }, (_, index) => index);
  const plusX = indices.slice().sort((a, b) => position.getX(b) - position.getX(a)).slice(0, 60);
  const bottom = indices
    .filter((index) => Math.abs(normal.getX(index)) < 0.5)
    .sort((a, b) => position.getY(a) - position.getY(b))
    .slice(0, 60);
  return {
    plusX: plusX.reduce((sum, index) => sum + normal.getX(index), 0) / plusX.length,
    bottomY: bottom.reduce((sum, index) => sum + normal.getY(index), 0) / bottom.length
  };
}

function groundScan(root: THREE.Object3D, length: number, radius: number): number {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      ).applyMatrix4(object.matrixWorld));
    }
  });
  let maximumError = 0;
  for (let z = -length / 2 + radius + 0.01; z <= length / 2 - radius - 0.01; z += 0.02) {
    const nearby = points.filter((point) => Math.abs(point.z - z) <= 0.011);
    if (!nearby.length) return Number.POSITIVE_INFINITY;
    const bottom = Math.min(...nearby.map((point) => point.y));
    maximumError = Math.max(maximumError, Math.abs(bottom + radius));
  }
  return maximumError;
}

const rubber = new THREE.MeshStandardMaterial();
const metal = new THREE.MeshStandardMaterial();
const rows: {
  id: string;
  kind: string;
  radius: number;
  maxRadius: number;
  excessMm: number;
  centerMm: [number, number, number];
  width: number;
  expectedWidth: number;
  groundErrorMm: number | null;
  normalX: number | null;
  normalY: number | null;
  finite: boolean;
}[] = [];
const problems: string[] = [];

for (const part of PARTS) {
  if (part.category !== "drive") continue;
  const def = part as DriveDef;
  const drive = def.kind === "track"
    ? createTrack(def, rubber, metal)
    : createTyre(def, rubber, metal);
  const { box, finite } = objectBounds(drive.root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxRadius = def.kind === "track"
    ? Math.max(Math.abs(box.min.y), box.max.y)
    : Math.max(Math.abs(box.min.y), box.max.y, Math.abs(box.min.z), box.max.z);
  const expectedWidth = def.kind === "track" ? Math.max(def.height, 0.08) : Math.max(def.height, CELL);
  const length = Math.max(...def.cells) * CELL;
  const normals = def.kind === "track" ? beltNormalStats(drive.root) : null;
  const groundError = def.kind === "track" ? groundScan(drive.root, length, def.radius) : null;
  const row = {
    id: def.id,
    kind: def.kind,
    radius: def.radius,
    maxRadius,
    excessMm: (maxRadius - def.radius) * 1000,
    centerMm: [center.x * 1000, center.y * 1000, center.z * 1000] as [number, number, number],
    width: size.x,
    expectedWidth,
    groundErrorMm: groundError === null ? null : groundError * 1000,
    normalX: normals?.plusX ?? null,
    normalY: normals?.bottomY ?? null,
    finite
  };
  rows.push(row);
  if (row.centerMm.some((value) => Math.abs(value) > 2)) problems.push(`${def.id}: off-center ${row.centerMm}`);
  if (row.excessMm > 0.5) problems.push(`${def.id}: radius excess ${row.excessMm.toFixed(3)}mm`);
  if (Math.abs(row.width - row.expectedWidth) > 0.002) {
    problems.push(`${def.id}: width ${(row.width * 1000).toFixed(3)}mm expected ${(row.expectedWidth * 1000).toFixed(3)}mm`);
  }
  if (row.groundErrorMm !== null && row.groundErrorMm > 1) {
    problems.push(`${def.id}: ground error ${row.groundErrorMm.toFixed(3)}mm`);
  }
  if (row.normalX !== null && row.normalX <= 0.5) problems.push(`${def.id}: +X normal ${row.normalX.toFixed(6)}`);
  if (row.normalY !== null && row.normalY >= -0.5) problems.push(`${def.id}: bottom normal ${row.normalY.toFixed(6)}`);
  if (!finite) problems.push(`${def.id}: NaN/Infinity`);
  if (def.kind === "track") {
    const scratch = trackWheelMatrixScratch;
    for (let index = 0; index < 100; index += 1) drive.applyPhase(index * 0.1);
    if (scratch !== trackWheelMatrixScratch) problems.push(`${def.id}: applyPhase replaced scratch Object3D`);
  }
}

console.log(JSON.stringify({
  drivesMeasured: rows.length,
  trackWheelScratchReused: true,
  rows,
  problems
}, null, 2));
if (problems.length) process.exitCode = 1;
