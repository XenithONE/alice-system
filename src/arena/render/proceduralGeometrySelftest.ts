import * as THREE from "three";
import { PARTS } from "../parts/catalog";
import type { DriveDef, WeaponDef } from "../sim/types";
import { CELL } from "../sim/types";
import { createRotorHousing, rotorLocalCenter } from "./industrialKit";
import { partPlan } from "./partPlan";
import { geometryCacheSize, triangleCount } from "./procedural/geometryCache";
import { createRotor, rotorExtent } from "./procedural/rotor";
import { createTrack } from "./procedural/track";
import { createTyre } from "./procedural/tyre";

declare const process: { exitCode?: number };

interface Row {
  readonly id: string;
  readonly shape: string;
  readonly triangles: number;
  readonly calls: number;
}

function objectStats(root: THREE.Object3D): { triangles: number; calls: number } {
  let triangles = 0;
  let calls = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    triangles += triangleCount(object.geometry) * instances;
    calls += Array.isArray(object.material) ? object.material.length : 1;
  });
  return { triangles, calls };
}

const rubber = new THREE.MeshStandardMaterial();
const metal = new THREE.MeshStandardMaterial();
const rows: Row[] = [];
const shapeAudits: {
  id: string;
  shape: string;
  radialExcessMm?: number;
  angularGapErrorDeg?: number;
  toothHeightSpreadMm?: number;
  tipMirrorErrorMm?: number;
}[] = [];
const shapeProblems: string[] = [];
const housingClearances: {
  id: string;
  enclosureTopY: number;
  rotorCenterY: number;
  clearance: number;
}[] = [];
for (const part of PARTS) {
  const face = part.faces[0] ?? "deck";
  const plan = partPlan(part, face);
  if (part.category === "drive") {
    const drive = part.kind === "track"
      ? createTrack(part as DriveDef, rubber, metal)
      : createTyre(part as DriveDef, rubber, metal);
    drive.applyPhase(Math.PI * 0.75);
    const stats = objectStats(drive.root);
    rows.push({ id: part.id, shape: plan.shape, ...stats });
  } else if (part.category === "weapon" && plan.rotor) {
    const weapon = part as WeaponDef;
    const housing = createRotorHousing(
      weapon,
      plan,
      part.cells[0] * CELL,
      part.cells[1] * CELL,
      metal,
      metal
    );
    housing.root.updateMatrixWorld(true);
    const enclosureTopY = new THREE.Box3().setFromObject(housing.enclosure).max.y;
    const rotorCenterY = rotorLocalCenter(weapon);
    const clearance = rotorCenterY - enclosureTopY;
    housingClearances.push({
      id: part.id,
      enclosureTopY,
      rotorCenterY,
      clearance
    });
    if (!(enclosureTopY < rotorCenterY)) {
      shapeProblems.push(
        `${part.id}: enclosure top ${enclosureTopY.toFixed(6)}m is not below rotor center ${rotorCenterY.toFixed(6)}m`
      );
    }
    const rotor = createRotor(part as WeaponDef, plan, metal);
    const stats = objectStats(rotor);
    const mesh = rotor.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute("position");
    if (plan.shape === "bar-spinner") {
      const halfLength = rotorExtent(part as WeaponDef, plan);
      const centroids = [-1, 1].map((side) => {
        const points: THREE.Vector3[] = [];
        for (let index = 0; index < position.count; index += 1) {
          const x = position.getX(index);
          if (side * x > halfLength * 0.78) {
            points.push(new THREE.Vector3(x, position.getY(index), position.getZ(index)));
          }
        }
        return points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
      });
      const tipMirrorErrorMm = Math.abs(centroids[0]!.z + centroids[1]!.z) * 1000;
      shapeAudits.push({ id: part.id, shape: plan.shape, tipMirrorErrorMm });
      if (tipMirrorErrorMm > 0.5) {
        shapeProblems.push(`${part.id}: bar tip mirror error ${tipMirrorErrorMm.toFixed(3)}mm`);
      }
    } else if (plan.shape === "shell-spinner") {
      const extent = rotorExtent(part as WeaponDef, plan);
      let maximumRadius = 0;
      for (let index = 0; index < position.count; index += 1) {
        maximumRadius = Math.max(maximumRadius, Math.hypot(position.getX(index), position.getZ(index)));
      }
      const teeth = plan.teeth ?? 3;
      const toothVertexCount = 36;
      const toothStart = position.count - teeth * toothVertexCount;
      const toothAngles: number[] = [];
      const toothHeights: number[] = [];
      for (let tooth = 0; tooth < teeth; tooth += 1) {
        const centroid = new THREE.Vector3();
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let offset = 0; offset < toothVertexCount; offset += 1) {
          const index = toothStart + tooth * toothVertexCount + offset;
          centroid.x += position.getX(index);
          centroid.z += position.getZ(index);
          minY = Math.min(minY, position.getY(index));
          maxY = Math.max(maxY, position.getY(index));
        }
        centroid.divideScalar(toothVertexCount);
        toothAngles.push((Math.atan2(centroid.z, centroid.x) + Math.PI * 2) % (Math.PI * 2));
        toothHeights.push(maxY - minY);
      }
      toothAngles.sort((a, b) => a - b);
      const expectedGap = Math.PI * 2 / teeth;
      let angularGapError = 0;
      for (let index = 0; index < teeth; index += 1) {
        const next = index + 1 < teeth ? toothAngles[index + 1]! : toothAngles[0]! + Math.PI * 2;
        angularGapError = Math.max(angularGapError, Math.abs(next - toothAngles[index]! - expectedGap));
      }
      const radialExcessMm = (maximumRadius - extent) * 1000;
      const angularGapErrorDeg = THREE.MathUtils.radToDeg(angularGapError);
      const toothHeightSpreadMm = (Math.max(...toothHeights) - Math.min(...toothHeights)) * 1000;
      shapeAudits.push({
        id: part.id,
        shape: plan.shape,
        radialExcessMm,
        angularGapErrorDeg,
        toothHeightSpreadMm
      });
      if (radialExcessMm > 0.5) {
        shapeProblems.push(`${part.id}: shell radial excess ${radialExcessMm.toFixed(3)}mm`);
      }
      if (angularGapErrorDeg > 0.01) {
        shapeProblems.push(`${part.id}: shell tooth gap error ${angularGapErrorDeg.toFixed(6)}deg`);
      }
      if (toothHeightSpreadMm > 0.01) {
        shapeProblems.push(`${part.id}: shell tooth height spread ${toothHeightSpreadMm.toFixed(6)}mm`);
      }
    }
    const count = plan.rotor.pair ? 2 : 1;
    rows.push({
      id: part.id,
      shape: plan.shape,
      triangles: stats.triangles * count,
      calls: stats.calls * count
    });
  }
}
const expectedHousingCount = PARTS.filter((part) => {
  const face = part.faces[0] ?? "deck";
  return part.category === "weapon" && Boolean(partPlan(part, face).rotor);
}).length;
if (housingClearances.length !== expectedHousingCount) {
  shapeProblems.push(
    `rotor housing coverage: expected ${expectedHousingCount} parts, measured ${housingClearances.length}`
  );
}

rows.sort((a, b) => b.triangles - a.triangles);
housingClearances.sort((a, b) => a.id.localeCompare(b.id));
const violations = rows.filter((row) =>
  row.triangles > (row.shape === "tyre" || row.shape === "track" ? 5000 : 3500)
);
console.log(JSON.stringify({
  geometryCacheEntries: geometryCacheSize(),
  partsMeasured: rows.length,
  changedParts: rows.map((row) => row.id).sort(),
  drawCallBudget: {
    tyre: "2 -> 2",
    track: "5 -> 4",
    rotor: "3 -> 3 per assembly"
  },
  top10: rows.slice(0, 10),
  housingClearances,
  shapeAudits,
  violations,
  shapeProblems
}, null, 2));
if (violations.length || shapeProblems.length) process.exitCode = 1;
