/**
 * Where a rotor is DRAWN versus where the rigid body that actually deals the
 * damage SITS.
 *
 * The first version of this gate compared `rotorLocalCenter(def)` against a
 * hand-copied `def.height / 2` — the same expression twice, so it reported
 * 0.000mm for all sixteen rotors and could never have failed. This version
 * derives the physics side independently: it mounts a real Object3D through the
 * production `mountPartObject` and compares the rotor's resulting chassis-space
 * position against `partLocalPosition`, which is what `assemble.ts` feeds to
 * `RigidBodyDesc.setTranslation`. Nothing here restates a renderer constant.
 */
import * as THREE from "three";
import { PARTS } from "../parts/catalog";
import { partLocalPosition } from "../sim/build";
import type { ChassisDef, MountFace, Rot4, WeaponDef } from "../sim/types";
import { rotorLocalCenter } from "./industrialKit";
import { mountPartObject } from "./mounting";

declare const process: { exitCode?: number };

const chassis = PARTS.find((part) => part.id === "chassis-medium") as ChassisDef | undefined;
if (!chassis) throw new Error("chassis-medium missing from the catalogue");

const rotations: readonly Rot4[] = [0, 1, 2, 3];
const rows: {
  id: string;
  face: MountFace;
  rot: Rot4;
  render: [number, number, number];
  physics: [number, number, number];
  errorMm: number;
}[] = [];
const problems: string[] = [];

for (const part of PARTS) {
  if (part.category !== "weapon") continue;
  if (part.effect !== "spin" && part.effect !== "grind") continue;
  const def = part as WeaponDef;
  for (const face of def.faces) {
    for (const rot of rotations) {
      // A rotor sits at (x, rotorLocalCenter, 0) inside the part group, and the
      // part group carries the yaw the kit applies for `rot`. Take x = 0: a
      // paired rotor is offset symmetrically, so the pair's centre is the same
      // point and the offset along the mount normal is what this gate measures.
      const group = new THREE.Group();
      group.rotation.y = rot * Math.PI / 2;
      const rotor = new THREE.Object3D();
      rotor.position.set(0, rotorLocalCenter(def), 0);
      group.add(rotor);
      mountPartObject(group, chassis, def, { partId: def.id, face, cell: [0, 0], rot });
      group.updateMatrixWorld(true);
      const drawn = new THREE.Vector3();
      rotor.getWorldPosition(drawn);

      const body = partLocalPosition(chassis, def, [0, 0], rot, face);
      const errorMm = drawn.distanceTo(new THREE.Vector3(body[0], body[1], body[2])) * 1000;
      rows.push({
        id: def.id,
        face,
        rot,
        render: [+drawn.x.toFixed(5), +drawn.y.toFixed(5), +drawn.z.toFixed(5)],
        physics: [+body[0].toFixed(5), +body[1].toFixed(5), +body[2].toFixed(5)],
        errorMm: +errorMm.toFixed(4)
      });
      if (errorMm > 5) {
        problems.push(`${def.id}/${face}/rot${rot}: rotor drawn ${errorMm.toFixed(2)}mm from its rigid body`);
      }
    }
  }
}

const worst = rows.reduce((a, b) => (b.errorMm > a.errorMm ? b : a), rows[0]!);
console.log(JSON.stringify({
  chassis: chassis.id,
  rotorsMeasured: new Set(rows.map((row) => row.id)).size,
  placementsChecked: rows.length,
  maxErrorMm: worst.errorMm,
  worst,
  problems
}, null, 2));
if (problems.length) process.exitCode = 1;
