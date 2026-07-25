import * as THREE from "three";
import { CELL, type WeaponDef } from "../../sim/types";
import type { PartPlan } from "../partPlan";
import { cachedGeometry } from "./geometryCache";
import { mergeParts, transformed } from "./merge";

function rotorRadius(def: WeaponDef): number {
  return Math.max(def.cells[0], def.cells[1]) * CELL / 2 + def.reach;
}

function sawGeometry(def: WeaponDef, teeth: number): THREE.BufferGeometry {
  return cachedGeometry(`rotor:saw:${def.id}:${teeth}`, () => {
    const radius = rotorRadius(def);
    const root = radius * 0.78;
    const shape = new THREE.Shape();
    for (let index = 0; index < teeth * 2; index += 1) {
      const tooth = Math.floor(index / 2);
      const leading = index % 2 === 0;
      const angle = (tooth + (leading ? 0.08 : 0.72)) / teeth * Math.PI * 2;
      const r = leading ? radius : root;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius * 0.13, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const disc = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.018, def.height * 0.38),
      bevelEnabled: true,
      bevelSize: 0.003,
      bevelThickness: 0.002,
      bevelSegments: 1,
      curveSegments: 2
    });
    disc.translate(0, 0, -Math.max(0.018, def.height * 0.38) / 2);
    disc.rotateX(-Math.PI / 2);
    const flange = new THREE.CylinderGeometry(radius * 0.24, radius * 0.24, Math.max(0.024, def.height * 0.52), 16);
    return mergeParts([disc, flange]);
  });
}

function drillGeometry(def: WeaponDef): THREE.BufferGeometry {
  return cachedGeometry(`rotor:drill:${def.id}`, () => {
    const length = Math.max(def.height, def.reach);
    const radius = Math.max(def.height / 2, 0.024) * 0.82;
    const parts: THREE.BufferGeometry[] = [];
    const core = new THREE.CylinderGeometry(radius * 0.62, radius * 0.88, length * 0.72, 16);
    core.translate(0, -length * 0.1, 0);
    parts.push(core);
    const tip = new THREE.ConeGeometry(radius * 0.9, length * 0.3, 16);
    tip.translate(0, length * 0.41, 0);
    parts.push(tip);
    for (let start = 0; start < 2; start += 1) {
      const points: THREE.Vector3[] = [];
      const turns = 2.4;
      for (let index = 0; index <= 36; index += 1) {
        const t = index / 36;
        const angle = start * Math.PI + t * Math.PI * 2 * turns;
        const taper = 1 - t * 0.34;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius * taper,
          -length * 0.42 + t * length * 0.75,
          Math.sin(angle) * radius * taper
        ));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 36, radius * 0.14, 5, false));
    }
    const collar = new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, length * 0.12, 16);
    collar.translate(0, -length * 0.46, 0);
    parts.push(collar);
    return mergeParts(parts);
  });
}

function drumGeometry(def: WeaponDef, bars: number): THREE.BufferGeometry {
  return cachedGeometry(`rotor:drum:${def.id}:${bars}`, () => {
    const radius = Math.max(def.height * 0.72, 0.07);
    const length = Math.max(def.cells[0], def.cells[1]) * CELL + def.reach * 0.5;
    const parts: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(radius * 0.82, radius * 0.82, length, 18)
    ];
    for (let index = 0; index < bars; index += 1) {
      const angle = index / bars * Math.PI * 2;
      const bar = new THREE.BoxGeometry(radius * 0.25, length * 0.94, radius * 0.18);
      bar.translate(radius * 0.88, 0, 0);
      bar.rotateY(angle);
      parts.push(bar);
    }
    for (const y of [-length / 2, length / 2]) {
      const end = new THREE.CylinderGeometry(radius, radius, Math.max(0.014, def.height * 0.1), 18);
      end.translate(0, y, 0);
      parts.push(end);
    }
    return mergeParts(parts);
  });
}

function barGeometry(def: WeaponDef): THREE.BufferGeometry {
  return cachedGeometry(`rotor:bar:${def.id}`, () => {
    const halfLength = rotorRadius(def);
    const thickness = Math.max(def.height * 0.55, 0.035);
    const width = Math.max(Math.min(...def.cells) * CELL * 0.24, 0.05);
    const bar = new THREE.BoxGeometry(halfLength * 1.7, thickness, width);
    const parts: THREE.BufferGeometry[] = [bar];
    for (const side of [-1, 1]) {
      const tip = new THREE.BoxGeometry(halfLength * 0.22, thickness * 1.35, width * 1.35);
      tip.rotateY(side * 0.16);
      tip.translate(side * halfLength * 0.91, 0, 0);
      parts.push(tip);
    }
    const hub = new THREE.CylinderGeometry(width * 0.72, width * 0.72, thickness * 1.4, 16);
    parts.push(hub);
    return mergeParts(parts);
  });
}

function shellGeometry(def: WeaponDef, teeth: number): THREE.BufferGeometry {
  return cachedGeometry(`rotor:shell:${def.id}:${teeth}`, () => {
    const radius = rotorRadius(def);
    const height = Math.max(def.height, 0.08);
    const profile = [
      new THREE.Vector2(radius * 0.18, -height * 0.5),
      new THREE.Vector2(radius * 0.78, -height * 0.46),
      new THREE.Vector2(radius, -height * 0.18),
      new THREE.Vector2(radius * 0.94, height * 0.2),
      new THREE.Vector2(radius * 0.62, height * 0.48),
      new THREE.Vector2(radius * 0.16, height * 0.5)
    ];
    const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(profile, 28)];
    for (let index = 0; index < teeth; index += 1) {
      const angle = index / teeth * Math.PI * 2;
      const toothLength = radius * 0.27;
      const toothWidth = radius * 0.12;
      const toothCenterRadius = Math.sqrt(radius ** 2 - (toothWidth / 2) ** 2) - toothLength / 2;
      const tooth = new THREE.BoxGeometry(toothLength, height * 0.32, toothWidth);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          Math.cos(angle) * toothCenterRadius,
          -height * 0.08,
          Math.sin(angle) * toothCenterRadius
        ),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle),
        new THREE.Vector3(1, 1, 1)
      );
      parts.push(transformed(tooth, matrix));
      tooth.dispose();
    }
    return mergeParts(parts);
  });
}

export function createRotor(
  def: WeaponDef,
  plan: PartPlan,
  material: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  group.name = `${plan.shape}-${def.id}`;
  let geometry: THREE.BufferGeometry;
  switch (plan.shape) {
    case "drill": geometry = drillGeometry(def); break;
    case "drum": geometry = drumGeometry(def, plan.teeth ?? 3); break;
    case "bar-spinner": geometry = barGeometry(def); break;
    case "shell-spinner": geometry = shellGeometry(def, plan.teeth ?? 3); break;
    default: geometry = sawGeometry(def, plan.teeth ?? 16); break;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

export function rotorExtent(def: WeaponDef, plan: PartPlan): number {
  if (plan.shape === "drill") return Math.max(def.height, def.reach) / 2;
  if (plan.shape === "drum") return Math.max(def.height * 0.72, 0.07);
  return rotorRadius(def);
}
