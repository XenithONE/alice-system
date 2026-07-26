import * as THREE from "three";
import {
  CELL,
  type BotSpec,
  type Catalog,
  type ChassisDef,
  type DriveDef,
  type MountFace,
  type PartDef,
  type PlacedPart
} from "../sim/types";
import { driveSide, hullLift, levelRises, partLocalPosition, riseForLevel } from "../sim/build";
import { legPhaseBias } from "./procedural/leg";

export function faceGridSize(chassis: ChassisDef, face: MountFace): readonly [number, number] {
  if (face === "internal") return chassis.internalGrid;
  if (face === "deck" || face === "underside") return chassis.deck;
  if (face === "left" || face === "right") return [chassis.deck[1], chassis.heightCells];
  return [chassis.deck[0], chassis.heightCells];
}

export function footprint(part: PartDef, rot: number): readonly [number, number] {
  return rot % 2 === 1 ? [part.cells[1], part.cells[0]] : part.cells;
}

/** 物理の車軸はどの取り付け面でもシャーシローカルX（assemble.ts の revolute axis）。 */
export const DRIVE_AXLE_AXIS = Object.freeze(new THREE.Vector3(1, 0, 0));

export function mountFaceQuaternion(face: MountFace): THREE.Quaternion {
  const rotation = new THREE.Quaternion();
  if (face === "underside") {
    rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else if (face === "left") {
    rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)
    ));
  } else if (face === "right") {
    rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)
    ));
  } else if (face === "front") {
    rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  } else if (face === "rear") {
    rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }
  return rotation;
}

/**
 * 段のオフセットの唯一の出典は build.ts の levelRises / riseForLevel。
 * 描画は 1機ぶんの rises を一度だけ作り、パーツごとにここで引くだけにする。
 * 描画側で rise を足し算した瞬間に「真実が2つ」になる（横付けタイヤ・ベルト裏返り・
 * 罠の半径と同じ構造の欠陥）ので、この関数の外で高さを組み立ててはならない。
 */
/**
 * Everything about a machine's vertical layout that depends on the WHOLE build
 * rather than on one part: the storey heights, and how far the hull rides above
 * its axles. Both come from build.ts.
 *
 * They travel together in one object on purpose. When they were two optional
 * trailing numbers, arenaScene and builderScene each passed the storey and
 * silently defaulted the hull lift to zero — so a leg machine drew its hull
 * 9 cm below where the physics had it, and nothing failed to compile.
 */
export interface BotMountGeometry {
  readonly rises: readonly number[];
  readonly hullLift: number;
}

export function botMountGeometry(spec: BotSpec, catalog: Catalog): BotMountGeometry {
  return { rises: levelRises(spec, catalog), hullLift: hullLift(spec, catalog) };
}

/** 段は deck 面でしか意味を持たない（H1）。他面は必ず 0。 */
export function partLevelRise(rises: readonly number[], placed: PlacedPart): number {
  return placed.face === "deck" ? riseForLevel(rises, placed.level ?? 0) : 0;
}

/**
 * 駆動の取り付け姿勢。車輪と履帯は無回転。脚だけは L4 の位相バイアス
 * `side < 0 ? 0 : π / feet` ぶん車軸まわりに回して置く＝左右で半歩ずれ、接地が交互になる。
 * side の決め方は assemble.ts と同じ driveSide（＋ローカルXの符号によるフォールバック）。
 */
export function driveMountQuaternion(
  chassis: ChassisDef,
  part: DriveDef,
  placed: PlacedPart,
  localX: number
): THREE.Quaternion {
  if (part.kind !== "leg") return new THREE.Quaternion();
  const side = driveSide(chassis, placed.face, placed.cell, footprint(part, placed.rot)[0])
    || (localX < 0 ? -1 : 1);
  return new THREE.Quaternion().setFromAxisAngle(DRIVE_AXLE_AXIS, legPhaseBias(part, side));
}

export function mountPartObject(
  object: THREE.Object3D,
  chassis: ChassisDef,
  part: PartDef,
  placed: PlacedPart,
  /** ビルダーのプレビュー用の浮かせ量。物理とは無関係。 */
  previewLift = 0,
  /**
   * 機体まるごとの縦の配置。botMountGeometry() の戻り値をそのまま渡すこと。
   * 省略すると v3 の幾何（1段・脚なし）になる。
   */
  geometry: BotMountGeometry = { rises: [0], hullLift: 0 }
): void {
  const levelRise = partLevelRise(geometry.rises, placed);
  const lift2 = geometry.hullLift;
  if (part.category === "drive") {
    // assemble.ts は駆動剛体を (local.x, radius, local.z) に置き、車軸を
    // シャーシローカルXに固定する。面にも rot にも依存しない。描画がこの2つを
    // そのまま使わない限り、車輪は「実際に転がっている場所」からずれて描かれる。
    const [x, , z] = partLocalPosition(chassis, part, placed.cell, placed.rot, placed.face, { levelRise, hullLift: lift2 });
    object.position.set(x, part.radius + previewLift, z);
    object.quaternion.copy(driveMountQuaternion(chassis, part, placed, x));
    return;
  }
  const [x, y, z] = partLocalPosition(chassis, part, placed.cell, placed.rot, placed.face, { levelRise, hullLift: lift2 });
  const normal = placed.face === "deck" ? new THREE.Vector3(0, 1, 0) :
    placed.face === "internal" ? new THREE.Vector3(0, 1, 0) :
    placed.face === "underside" ? new THREE.Vector3(0, -1, 0) :
    placed.face === "left" ? new THREE.Vector3(-1, 0, 0) :
    placed.face === "right" ? new THREE.Vector3(1, 0, 0) :
    placed.face === "front" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  object.position.set(x, y, z).addScaledVector(normal, -part.height / 2 + previewLift);

  const partRotation = object.quaternion.clone();
  const mountRotation = mountFaceQuaternion(placed.face);
  object.quaternion.copy(mountRotation).multiply(partRotation);
}
