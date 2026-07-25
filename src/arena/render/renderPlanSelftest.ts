import * as THREE from "three";
import { PARTS } from "../parts/catalog";
import type { MountFace, Rot4, WeaponDef } from "../sim/types";
import { weaponRigAxis } from "./industrialKit";
import { mountFaceQuaternion } from "./mounting";
import { partPlan } from "./partPlan";

declare const process: { exitCode?: number };

const problems: string[] = [];
const faces: readonly MountFace[] = ["deck", "underside", "left", "right", "front", "rear"];
const rotations: readonly Rot4[] = [0, 1, 2, 3];

function expectedAxis(part: WeaponDef, face: MountFace): THREE.Vector3 {
  if (part.effect !== "spin" && part.effect !== "grind") return new THREE.Vector3(1, 0, 0);
  if (part.spinAxis !== "vertical") {
    if (face === "deck") return new THREE.Vector3(0, 1, 0);
    if (face === "underside") return new THREE.Vector3(0, -1, 0);
    if (face === "left") return new THREE.Vector3(-1, 0, 0);
    if (face === "right") return new THREE.Vector3(1, 0, 0);
    if (face === "front") return new THREE.Vector3(0, 0, -1);
    return new THREE.Vector3(0, 0, 1);
  }
  return face === "left" || face === "right"
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
}

const shapes = new Set<string>();
let plans = 0;
let rotorChecks = 0;
let revoluteAxisChecks = 0;
let minimumAxisDot = 1;
for (const part of PARTS) {
  for (const face of part.faces.length ? part.faces : faces) {
    for (const rot of rotations) {
      const plan = partPlan(part, face);
      plans += 1;
      shapes.add(plan.shape);
      if (part.category !== "weapon") continue;
      if (part.effect === "spin" || part.effect === "grind") {
        rotorChecks += 1;
        if (!plan.rotor) {
          problems.push(`${part.id}/${face}/rot${rot}: missing rotor plan`);
          continue;
        }
        if (plan.rotor.pair !== (part.pairMount === true)) {
          problems.push(`${part.id}/${face}/rot${rot}: pair=${plan.rotor.pair} expected ${part.pairMount === true}`);
        }
      }
      if (
        part.effect !== "spin" &&
        part.effect !== "grind" &&
        part.effect !== "impulse" &&
        part.effect !== "clamp"
      ) continue;
      revoluteAxisChecks += 1;
      const rendered = weaponRigAxis(part, face, rot)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * Math.PI / 2)
        .applyQuaternion(mountFaceQuaternion(face))
        .normalize();
      const dot = Math.abs(rendered.dot(expectedAxis(part, face)));
      minimumAxisDot = Math.min(minimumAxisDot, dot);
      if (dot < 0.999) {
        problems.push(`${part.id}/${face}/rot${rot}: |axis dot|=${dot.toFixed(6)}`);
      }
    }
  }
}

for (const required of ["saw-disc", "drill", "drum", "bar-spinner", "shell-spinner"]) {
  if (!shapes.has(required)) problems.push(`missing distinct rotor shape ${required}`);
}
if (PARTS.length !== 72) problems.push(`catalog part count ${PARTS.length}, expected 72`);

console.log(JSON.stringify({
  parts: PARTS.length,
  plans,
  rotations: rotations.length,
  rotorChecks,
  revoluteAxisChecks,
  minimumAxisDot,
  rotorShapes: [...shapes].filter((shape) =>
    ["saw-disc", "drill", "drum", "bar-spinner", "shell-spinner"].includes(shape)
  ),
  problems
}, null, 2));
if (problems.length) process.exitCode = 1;
