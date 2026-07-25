import * as THREE from "three";
import { CELL, type ChassisDef, type MountFace, type PartDef, type PlacedPart } from "../sim/types";
import { partLocalPosition } from "../sim/build";

export function faceGridSize(chassis: ChassisDef, face: MountFace): readonly [number, number] {
  if (face === "deck" || face === "underside") return chassis.deck;
  if (face === "left" || face === "right") return [chassis.deck[1], chassis.heightCells];
  return [chassis.deck[0], chassis.heightCells];
}

export function footprint(part: PartDef, rot: number): readonly [number, number] {
  return rot % 2 === 1 ? [part.cells[1], part.cells[0]] : part.cells;
}

/** 物理の車軸はどの取り付け面でもシャーシローカルX（assemble.ts の revolute axis）。 */
export const DRIVE_AXLE_AXIS = Object.freeze(new THREE.Vector3(1, 0, 0));

export function mountPartObject(
  object: THREE.Object3D,
  chassis: ChassisDef,
  part: PartDef,
  placed: PlacedPart,
  lift = 0
): void {
  if (part.category === "drive") {
    // assemble.ts は駆動剛体を (local.x, radius, local.z) に置き、車軸を
    // シャーシローカルXに固定する。面にも rot にも依存しない。描画がこの2つを
    // そのまま使わない限り、車輪は「実際に転がっている場所」からずれて描かれる。
    const [x, , z] = partLocalPosition(chassis, part, placed.cell, placed.rot, placed.face);
    object.position.set(x, part.radius + lift, z);
    object.quaternion.identity();
    return;
  }
  const [x, y, z] = partLocalPosition(chassis, part, placed.cell, placed.rot, placed.face);
  const normal = placed.face === "deck" ? new THREE.Vector3(0, 1, 0) :
    placed.face === "underside" ? new THREE.Vector3(0, -1, 0) :
    placed.face === "left" ? new THREE.Vector3(-1, 0, 0) :
    placed.face === "right" ? new THREE.Vector3(1, 0, 0) :
    placed.face === "front" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  object.position.set(x, y, z).addScaledVector(normal, -part.height / 2 + lift);

  const partRotation = object.quaternion.clone();
  const mountRotation = new THREE.Quaternion();
  if (placed.face === "underside") {
    mountRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else if (placed.face === "left") {
    mountRotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)
    ));
  } else if (placed.face === "right") {
    mountRotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)
    ));
  } else if (placed.face === "front") {
    mountRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  } else if (placed.face === "rear") {
    mountRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }
  object.quaternion.copy(mountRotation).multiply(partRotation);
}
