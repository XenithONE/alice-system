import * as THREE from "three";
import { CELL, type DriveDef } from "../../sim/types";
import { cachedGeometry } from "./geometryCache";
import { mergeParts, transformed } from "./merge";
import type { ProceduralDrive } from "./types";

/*
 * 脚駆動の描画（ARCHITECTURE_V4 §1.3 / §6.4）。
 *
 * 物理は「剛体1・revolute 1・モータ速度1」で車輪と同じ位相構造を取り、脚は車軸から
 * 放射状に伸びる feet 本のカプセルでしかない。描画も同じ本数・同じ角度・同じ最遠点で
 * 描く。ここで別の式を書いた瞬間に、このプロジェクトが3回踏んだ
 * 「横付けタイヤが5cm上7cm外」「ベルトが裏返る」「罠の判定半径と描画半径が別数値」と
 * 同じ構造になる。したがって角度・最遠点・位相バイアスは
 * すべて本ファイルの legSpokeAngle / legFootTip / legPhaseBias を唯一の出典とし、
 * 造形（大腿・膝・脛・足パッド）はその上に乗るだけの飾りに徹する。
 *
 * 膝は曲げてよいが、足パッドの最遠点は必ず車軸から def.radius。パッドは
 * 「中心が車軸から radius - padRadius にある球」なので、その極が厳密に radius に来る。
 * これは物理カプセルの外側の半球キャップそのものであり、丸め誤差以外のずれが入らない。
 */

export const LEG_MIN_FEET = 2;
export const LEG_MAX_FEET = 8;

/** 脚の本数。カタログが壊れていても描画は落とさない。 */
export function legFeet(def: DriveDef): number {
  return THREE.MathUtils.clamp(Math.round(def.feet ?? 2), LEG_MIN_FEET, LEG_MAX_FEET);
}

/** 車軸方向の幅。タイヤと同じ式＝driveGeometrySelftest の expectedWidth と一致する。 */
export function legAxleWidth(def: DriveDef): number {
  return Math.max(def.height, CELL);
}

/**
 * §6.4 のカプセル寸法。`d = radius - halfHeight - capsuleRadius` なので
 * 最遠点は厳密に radius。物理側が同じ契約で組む前提の参照値でもある。
 */
export interface LegCapsule {
  /** カプセル半径 */
  readonly capsuleRadius: number;
  /** カプセルの円筒部の半分の長さ */
  readonly halfHeight: number;
  /** 車軸からカプセル中心までの距離 */
  readonly d: number;
  /** 車軸に近い側の端点（＝ハブとの接続点） */
  readonly inner: number;
  /** ハブの外形半径 */
  readonly hubRadius: number;
}

export function legCapsule(def: DriveDef): LegCapsule {
  const radius = def.radius;
  const hubRadius = radius * 0.3;
  const inner = hubRadius * 0.72;
  const span = (radius - inner) / 2;
  const capsuleRadius = Math.min(
    Math.max(radius * 0.105, 0.008),
    legAxleWidth(def) * 0.44,
    span * 0.6
  );
  return {
    capsuleRadius,
    halfHeight: span - capsuleRadius,
    d: (radius + inner) / 2,
    inner,
    hubRadius
  };
}

/** 第 k 本の脚の角度 θ_k = 2πk / feet（YZ平面内）。 */
export function legSpokeAngle(def: DriveDef, k: number): number {
  return 2 * Math.PI * k / legFeet(def);
}

/**
 * L4 の位相バイアス。左右で半歩ずらすことで接地が交互になり、跳ねずに歩く。
 * assemble.ts が剛体の初期姿勢に入れるのと同じ値を、描画は取り付け時の姿勢に入れる。
 */
export function legPhaseBias(def: DriveDef, side: number): number {
  return side < 0 ? 0 : Math.PI / legFeet(def);
}

/** 第 k 本の足先（車軸ローカル）。定義上 |tip| === def.radius。 */
export function legFootTip(def: DriveDef, k: number): THREE.Vector3 {
  const angle = legSpokeAngle(def, k);
  return new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)).multiplyScalar(def.radius);
}

export function legFootTips(def: DriveDef): THREE.Vector3[] {
  return Array.from({ length: legFeet(def) }, (_, k) => legFootTip(def, k));
}

/** +Y を a→b に向けた円錐台。XZ 断面は sx でだけ広げる（＝車軸方向にだけ太らせる）。 */
function linkBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radiusAtA: number,
  radiusAtB: number,
  segments: number,
  sx: number
): THREE.BufferGeometry {
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.hypot(dy, dz);
  const geometry = new THREE.CylinderGeometry(radiusAtB, radiusAtA, Math.max(length, 1e-5), segments);
  geometry.scale(sx, 1, 1);
  // a→b は必ず YZ 平面内なので、姿勢は X 軸まわりの回転だけで済む。
  // ＝ ローカルXが常にワールドXのまま＝上の sx が「車軸方向の太さ」であり続ける。
  geometry.rotateX(Math.atan2(dz, dy));
  geometry.translate(0, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

function hubParts(def: DriveDef): THREE.BufferGeometry[] {
  const radius = def.radius;
  const width = legAxleWidth(def);
  const { hubRadius } = legCapsule(def);
  const parts: THREE.BufferGeometry[] = [];
  // 車輪のリムと同じ語彙: バレル＋左右のビードリング＋中央ボス＋外面のボルト。
  const barrel = new THREE.CylinderGeometry(hubRadius, hubRadius, width, 20);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  for (const side of [-1, 1]) {
    // リングは車軸方向に tube ぶん膨らむ。ハブのバレル（幅ちょうど width）より
    // 外に出ると driveGeometrySelftest の幅検査が狂うので、内側に収める。
    const tube = Math.min(radius * 0.035, width * 0.08);
    const ring = new THREE.TorusGeometry(hubRadius * 0.86, tube, 5, 20);
    ring.rotateY(Math.PI / 2);
    ring.translate(side * (width * 0.5 - tube * 1.02), 0, 0);
    parts.push(ring);
  }
  const boss = new THREE.CylinderGeometry(hubRadius * 0.44, hubRadius * 0.44, width * 0.98, 14);
  boss.rotateZ(Math.PI / 2);
  parts.push(boss);
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(radius * 0.026, radius * 0.026, width * 0.05, 6);
    bolt.rotateZ(Math.PI / 2);
    bolt.translate(
      width * 0.475,
      Math.cos(angle) * hubRadius * 0.66,
      Math.sin(angle) * hubRadius * 0.66
    );
    parts.push(bolt);
  }
  return parts;
}

interface SpokeShape {
  readonly ankle: THREE.Vector3;
  readonly padCenter: THREE.Vector3;
  readonly padRadius: number;
  readonly padScaleX: number;
}

function spokeShape(def: DriveDef): SpokeShape {
  const { capsuleRadius } = legCapsule(def);
  const padRadius = capsuleRadius * 1.28;
  const padCenterY = def.radius - padRadius;
  return {
    ankle: new THREE.Vector3(0, padCenterY - padRadius * 0.35, 0),
    padCenter: new THREE.Vector3(0, padCenterY, 0),
    padRadius,
    padScaleX: Math.min(legAxleWidth(def) * 0.4 / padRadius, 1.9)
  };
}

/** 1本ぶんの金属リンク（大腿＋膝ブロック＋脛）を θ=0 の姿勢で作る。 */
function spokeMetalParts(def: DriveDef): THREE.BufferGeometry[] {
  const radius = def.radius;
  const width = legAxleWidth(def);
  const { capsuleRadius, inner } = legCapsule(def);
  const { ankle } = spokeShape(def);
  const hip = new THREE.Vector3(0, inner, 0);
  const knee = new THREE.Vector3(0, radius * 0.6, -radius * 0.14);
  const parts: THREE.BufferGeometry[] = [];
  // 車軸方向にどれだけ太らせても、ハブのバレル（幅ちょうど width）から出てはならない。
  const widen = (thickest: number, wanted: number): number =>
    Math.min(wanted, width * 0.45 / Math.max(thickest, 1e-6));

  // 大腿: ハブ側が太く、膝に向かって少し細る。
  parts.push(linkBetween(
    hip, knee, capsuleRadius * 1.35, capsuleRadius * 1.05, 6, widen(capsuleRadius * 1.35, 1.55)
  ));

  // 膝の関節ブロック。
  const kneeBlock = new THREE.BoxGeometry(width * 0.62, capsuleRadius * 2.3, capsuleRadius * 2.3);
  kneeBlock.translate(knee.x, knee.y, knee.z);
  parts.push(kneeBlock);
  // 膝の軸ピン（車軸と平行に貫通する1本）。
  const pin = new THREE.CylinderGeometry(capsuleRadius * 0.42, capsuleRadius * 0.42, width * 0.74, 8);
  pin.rotateZ(Math.PI / 2);
  pin.translate(0, knee.y, knee.z);
  parts.push(pin);

  // 脛: 膝から足首に向かって先細り。
  parts.push(linkBetween(knee, ankle, capsuleRadius, capsuleRadius * 0.66, 6, widen(capsuleRadius, 1.15)));

  return parts;
}

function legMetalGeometry(def: DriveDef): THREE.BufferGeometry {
  return cachedGeometry(`leg-frame:${def.id}:${legAxleWidth(def)}:${legFeet(def)}`, () => {
    const parts = hubParts(def);
    const feet = legFeet(def);
    for (let k = 0; k < feet; k += 1) {
      const matrix = new THREE.Matrix4().makeRotationX(legSpokeAngle(def, k));
      for (const source of spokeMetalParts(def)) {
        parts.push(transformed(source, matrix));
        source.dispose();
      }
    }
    const merged = mergeParts(parts);
    parts.forEach((geometry) => geometry.dispose());
    return merged;
  });
}

function legPadGeometry(def: DriveDef): THREE.BufferGeometry {
  return cachedGeometry(`leg-pad:${def.id}:${legAxleWidth(def)}:${legFeet(def)}`, () => {
    const { padCenter, padRadius, padScaleX } = spokeShape(def);
    const parts: THREE.BufferGeometry[] = [];
    const feet = legFeet(def);
    for (let k = 0; k < feet; k += 1) {
      // 極が厳密に +Y の padCenter.y + padRadius = def.radius に来る。
      // Y はスケールしない（＝最遠点を触らない）。太らせるのは車軸方向 X だけ。
      const pad = new THREE.SphereGeometry(padRadius, 10, 6);
      pad.scale(padScaleX, 1, 1);
      pad.translate(padCenter.x, padCenter.y, padCenter.z);
      const matrix = new THREE.Matrix4().makeRotationX(legSpokeAngle(def, k));
      parts.push(transformed(pad, matrix));
      pad.dispose();
    }
    const merged = mergeParts(parts);
    parts.forEach((geometry) => geometry.dispose());
    return merged;
  });
}

export function createLeg(
  def: DriveDef,
  rubber: THREE.Material,
  metal: THREE.Material
): ProceduralDrive {
  const root = new THREE.Group();
  root.name = `leg-${def.id}`;
  const frame = new THREE.Mesh(legMetalGeometry(def), metal);
  const pads = new THREE.Mesh(legPadGeometry(def), rubber);
  frame.castShadow = frame.receiveShadow = true;
  pads.castShadow = pads.receiveShadow = true;
  root.add(frame, pads);
  return {
    root,
    applyPhase(phase) {
      // 車輪と同じくハブごと回す。リンクを個別に動かさない＝物理と一致する。
      root.rotation.x = phase;
    }
  };
}
