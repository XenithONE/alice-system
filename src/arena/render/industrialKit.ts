import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  CELL,
  type MountFace,
  type PartDef,
  type Rot4,
  type SurfaceMaterial,
  type WeaponDef
} from "../sim/types";

export const MATERIAL_FINISH: Record<SurfaceMaterial, { metalness: number; roughness: number }> = {
  steel: { metalness: 0.9, roughness: 0.45 },
  titanium: { metalness: 0.85, roughness: 0.3 },
  hardox: { metalness: 0.95, roughness: 0.38 },
  aluminium: { metalness: 0.72, roughness: 0.42 },
  polymer: { metalness: 0.05, roughness: 0.7 },
  rubber: { metalness: 0, roughness: 0.95 },
  carbon: { metalness: 0.15, roughness: 0.5 },
  brass: { metalness: 0.8, roughness: 0.3 }
};

const textureCache = new Map<string, { color: THREE.CanvasTexture; roughness: THREE.CanvasTexture }>();

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function textureSet(color: number, surface: SurfaceMaterial): { color: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const key = `${surface}-${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const colorCanvas = document.createElement("canvas");
  const roughCanvas = document.createElement("canvas");
  colorCanvas.width = roughCanvas.width = 128;
  colorCanvas.height = roughCanvas.height = 128;
  const colorContext = colorCanvas.getContext("2d")!;
  const roughContext = roughCanvas.getContext("2d")!;
  const random = seeded(color ^ surface.length * 0x9e3779b9);
  const base = new THREE.Color(color);
  colorContext.fillStyle = `#${base.getHexString()}`;
  colorContext.fillRect(0, 0, 128, 128);
  roughContext.fillStyle = "#909090";
  roughContext.fillRect(0, 0, 128, 128);

  for (let index = 0; index < 620; index += 1) {
    const x = random() * 128;
    const y = random() * 128;
    const alpha = 0.025 + random() * 0.11;
    const light = random() > 0.68;
    colorContext.fillStyle = light ? `rgba(238,241,236,${alpha})` : `rgba(16,18,18,${alpha})`;
    colorContext.fillRect(x, y, 0.5 + random() * 2.2, 0.5 + random() * 1.2);
    const gray = Math.round(65 + random() * 145);
    roughContext.fillStyle = `rgb(${gray},${gray},${gray})`;
    roughContext.fillRect(x, y, 1 + random() * 2.5, 1 + random() * 1.5);
  }

  colorContext.lineCap = roughContext.lineCap = "round";
  for (let index = 0; index < 34; index += 1) {
    const x = random() * 110;
    const y = random() * 128;
    const length = 8 + random() * 42;
    colorContext.strokeStyle = `rgba(${random() > 0.5 ? "225,225,215" : "20,16,13"},${0.1 + random() * 0.24})`;
    colorContext.lineWidth = 0.35 + random() * 0.9;
    colorContext.beginPath();
    colorContext.moveTo(x, y);
    colorContext.lineTo(x + length, y + (random() - 0.5) * 5);
    colorContext.stroke();
    roughContext.strokeStyle = "#d2d2d2";
    roughContext.lineWidth = 1;
    roughContext.beginPath();
    roughContext.moveTo(x, y);
    roughContext.lineTo(x + length, y + (random() - 0.5) * 5);
    roughContext.stroke();
  }
  for (const context of [colorContext, roughContext]) {
    const burn = context.createRadialGradient(108, 20, 0, 108, 20, 30);
    burn.addColorStop(0, "rgba(8,7,6,.48)");
    burn.addColorStop(1, "rgba(8,7,6,0)");
    context.fillStyle = burn;
    context.fillRect(76, 0, 52, 52);
  }

  const colorTexture = new THREE.CanvasTexture(colorCanvas);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  const roughTexture = new THREE.CanvasTexture(roughCanvas);
  for (const texture of [colorTexture, roughTexture]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.7, 1.7);
    texture.anisotropy = 4;
  }
  const result = { color: colorTexture, roughness: roughTexture };
  textureCache.set(key, result);
  return result;
}

export function industrialMaterial(
  surface: SurfaceMaterial,
  color: number,
  options: { transparent?: boolean; opacity?: number; wear?: boolean } = {}
): THREE.MeshStandardMaterial {
  const finish = MATERIAL_FINISH[surface];
  const maps = options.wear === false ? null : textureSet(color, surface);
  return new THREE.MeshStandardMaterial({
    color: maps ? 0xffffff : color,
    map: maps?.color ?? null,
    roughnessMap: maps?.roughness ?? null,
    metalness: finish.metalness,
    roughness: finish.roughness,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: !(options.transparent ?? false)
  });
}

function box(w: number, h: number, d: number, radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, h * 0.22)), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function bolt(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 6), material);
  mesh.castShadow = true;
  return mesh;
}

function addBoltRows(group: THREE.Group, w: number, d: number, y: number, material: THREE.Material): void {
  const countX = Math.max(2, Math.min(6, Math.round(w / 0.16)));
  for (let index = 0; index < countX; index += 1) {
    const x = countX === 1 ? 0 : THREE.MathUtils.lerp(-w * 0.39, w * 0.39, index / (countX - 1));
    for (const z of [-d * 0.38, d * 0.38]) {
      const fastener = bolt(material);
      fastener.position.set(x, y, z);
      group.add(fastener);
    }
  }
}

function addCable(group: THREE.Group, w: number, d: number): void {
  const points = [
    new THREE.Vector3(-w * 0.28, 0.025, d * 0.16),
    new THREE.Vector3(-w * 0.05, 0.06, d * 0.04),
    new THREE.Vector3(w * 0.28, 0.035, -d * 0.14)
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 12, 0.009, 6, false),
    industrialMaterial("rubber", 0x151719, { wear: false })
  );
  cable.castShadow = true;
  group.add(cable);
}

function addHydraulic(group: THREE.Group, length: number, y: number, z: number): void {
  const brass = industrialMaterial("brass", 0xa7742b);
  const steel = industrialMaterial("steel", 0x8d9292);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, length * 0.56, 12), brass);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, length * 0.52, 10), steel);
  barrel.rotation.x = rod.rotation.x = Math.PI / 2;
  barrel.position.set(0, y, z + length * 0.11);
  rod.position.set(0, y, z - length * 0.25);
  group.add(barrel, rod);
}

function wedgeGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const vertices = new Float32Array([
    -w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2,
    -w / 2, h, d / 2, w / 2, h, d / 2
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    3, 2, 5, 3, 5, 4,
    0, 4, 5, 0, 5, 1,
    0, 3, 4, 1, 5, 2
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface IndustrialPart {
  readonly root: THREE.Group;
  readonly wheel: THREE.Object3D | null;
  readonly weapon: WeaponRig | null;
}

export interface WeaponRig {
  readonly def: WeaponDef;
  readonly moving: THREE.Object3D[];
  readonly blurs: THREE.Mesh[];
  readonly flameOrigin: THREE.Object3D | null;
  readonly mode: "spin" | "spear" | "arm" | "crusher" | "static" | "flame";
  readonly spinAxis: THREE.Vector3;
  readonly bases: THREE.Quaternion[];
}

export function createIndustrialPart(
  part: PartDef,
  rot: Rot4,
  paint: number,
  transparent = false,
  face: MountFace = "deck"
): IndustrialPart {
  const root = new THREE.Group();
  root.rotation.y = rot * Math.PI / 2;
  const swap = rot === 1 || rot === 3;
  const w = (swap ? part.cells[1] : part.cells[0]) * CELL;
  const d = (swap ? part.cells[0] : part.cells[1]) * CELL;
  const h = Math.max(part.height, 0.025);
  const baseColor = part.category === "armor" || part.category === "chassis" ? paint : part.color;
  const material = industrialMaterial(part.material, baseColor, {
    transparent,
    opacity: transparent ? 0.44 : 1
  });
  const darkSteel = industrialMaterial("steel", 0x303537);
  const brightSteel = industrialMaterial("steel", 0xaeb4b3);
  const rubber = industrialMaterial("rubber", 0x111315);
  if (part.category !== "drive") {
    let body: THREE.Mesh;
    if ((part.category === "armor" && part.id.includes("wedge")) ||
        (part.category === "weapon" && part.effect === "static")) {
      body = new THREE.Mesh(wedgeGeometry(w * 0.96, h, d * 0.96), material);
      body.castShadow = true;
      body.receiveShadow = true;
    } else {
      body = box(w * 0.96, h, d * 0.96, 0.009, material);
      body.position.y = h * 0.5;
    }
    root.add(body);
    addBoltRows(root, w, d, h + 0.007, brightSteel);
  }

  let wheel: THREE.Object3D | null = null;
  let weapon: WeaponRig | null = null;
  if (part.category === "drive") {
    const axleWidth = part.kind === "track"
      ? Math.max(part.height, 0.08)
      : Math.max(part.height, CELL);
    const beltLength = Math.max(part.cells[0], part.cells[1]) * CELL;
    if (part.kind === "track") {
      const track = box(axleWidth, part.radius * 2, beltLength, 0.018, rubber);
      const inner = box(axleWidth * 0.82, part.radius * 1.5, beltLength * 0.84, 0.012, darkSteel);
      root.add(track, inner);
      const sprockets = new THREE.Group();
      for (const z of [-beltLength * 0.36, 0, beltLength * 0.36]) {
        const sprocket = new THREE.Mesh(
          new THREE.CylinderGeometry(part.radius * 0.55, part.radius * 0.55, axleWidth * 1.02, 14),
          brightSteel
        );
        sprocket.rotation.z = Math.PI / 2;
        sprocket.position.z = z;
        sprockets.add(sprocket);
      }
      root.add(sprockets);
      wheel = sprockets;
    } else {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(part.radius, part.radius, axleWidth, 20),
        rubber
      );
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(part.radius * 0.48, part.radius * 0.48, axleWidth * 1.04, 12),
        brightSteel
      );
      hub.rotation.z = Math.PI / 2;
      root.add(tire, hub);
      wheel = tire;
    }
  } else if (part.category === "weapon") {
    const moving: THREE.Object3D[] = [];
    const blurs: THREE.Mesh[] = [];
    let flameOrigin: THREE.Object3D | null = null;
    let mode: WeaponRig["mode"] = "static";
    let spinAxis = new THREE.Vector3(0, 1, 0);
    const rotorRadius = Math.max(Math.min(w, d) * 0.43, 0.09);
    if (part.effect === "spin" || part.effect === "grind") {
      spinAxis = part.spinAxis !== "vertical"
        ? new THREE.Vector3(0, 1, 0)
        : (face === "left" || face === "right")
          ? new THREE.Vector3(0, 0, face === "left" ? -1 : 1)
          : new THREE.Vector3(1, 0, 0);
      const rotorBase = spinAxis.y !== 0
        ? new THREE.Quaternion()
        : spinAxis.z !== 0
          ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
          : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      const guardBase = rotorBase.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI * 0.18));
      const rotorXs = part.pairMount === true ? [-w * 0.33, w * 0.33] : [0];
      mode = "spin";
      for (const x of rotorXs) {
        const rotor = new THREE.Mesh(
          new THREE.CylinderGeometry(rotorRadius, rotorRadius, Math.max(0.025, h * 0.42), part.type === "drum" ? 16 : 28),
          brightSteel
        );
        rotor.position.set(x, h + rotorRadius * (spinAxis.y !== 0 ? 0.12 : 0.72), 0);
        rotor.quaternion.copy(rotorBase);
        root.add(rotor);
        moving.push(rotor);

        const guard = new THREE.Mesh(
          new THREE.TorusGeometry(rotorRadius * 1.04, 0.018, 8, 28, Math.PI * 1.35),
          darkSteel
        );
        guard.position.copy(rotor.position);
        guard.quaternion.copy(guardBase);
        root.add(guard);

        const blur = new THREE.Mesh(
          new THREE.CylinderGeometry(rotorRadius * 1.08, rotorRadius * 1.08, 0.008, 32),
          new THREE.MeshBasicMaterial({
            color: 0xd9dddd,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        );
        blur.position.copy(rotor.position);
        blur.quaternion.copy(rotorBase);
        root.add(blur);
        blurs.push(blur);
      }
    } else if (part.effect === "flame") {
      mode = "flame";
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, d * 0.55, 14), industrialMaterial("brass", 0x9b6a25));
      tank.rotation.x = Math.PI / 2;
      tank.position.y = h + 0.06;
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.045, 0.18, 10), darkSteel);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(0, h + 0.07, -d * 0.54);
      flameOrigin = new THREE.Object3D();
      flameOrigin.position.set(0, 0, -0.12);
      nozzle.add(flameOrigin);
      root.add(tank, nozzle);
    } else if (part.id.includes("spear")) {
      mode = "spear";
      const spear = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, d * 0.78, 10), brightSteel);
      rod.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 4), brightSteel);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -d * 0.46;
      spear.position.set(0, h + 0.045, -d * 0.18);
      spear.add(rod, tip);
      root.add(spear);
      moving.push(spear);
      addHydraulic(root, d * 0.72, h + 0.04, 0);
    } else if (part.effect === "clamp") {
      mode = "crusher";
      for (const side of [-1, 1]) {
        const jaw = new THREE.Group();
        const arm = box(w * 0.2, 0.045, d * 0.88, 0.006, material);
        arm.position.set(side * w * 0.3, 0, -d * 0.2);
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 4), brightSteel);
        tooth.rotation.x = -Math.PI / 2;
        tooth.position.set(side * w * 0.3, -0.04, -d * 0.65);
        jaw.position.y = h + 0.08;
        jaw.add(arm, tooth);
        root.add(jaw);
        moving.push(jaw);
      }
      addHydraulic(root, d * 0.6, h + 0.05, d * 0.05);
    } else if (part.effect === "impulse") {
      mode = "arm";
      const arm = new THREE.Group();
      const beam = box(w * 0.72, 0.045, d * 0.86, 0.007, material);
      beam.position.z = -d * 0.28;
      arm.position.set(0, h + 0.035, d * 0.22);
      arm.add(beam);
      if (part.id.includes("axe") || part.id.includes("hammer")) {
        const head = box(w * 0.72, 0.1, 0.12, 0.008, darkSteel);
        head.position.z = -d * 0.74;
        arm.add(head);
      }
      root.add(arm);
      moving.push(arm);
      addHydraulic(root, d * 0.62, h + 0.05, d * 0.08);
    } else if (part.id.includes("fork")) {
      for (const x of [-w * 0.27, w * 0.27]) {
        const fork = box(0.045, 0.025, d * 1.25, 0.004, material);
        fork.position.set(x, 0.018, -d * 0.3);
        root.add(fork);
      }
    }
    addCable(root, w, d);
    weapon = {
      def: part,
      moving,
      blurs,
      flameOrigin,
      mode,
      spinAxis,
      bases: moving.map((object) => object.quaternion.clone())
    };
  } else if (part.category === "utility") {
    addCable(root, w, d);
  }
  return { root, wheel, weapon };
}

export function applyWeaponRig(rig: WeaponRig, angle: number, omega: number, active: boolean): void {
  if (rig.mode === "spin") {
    const q = new THREE.Quaternion().setFromAxisAngle(rig.spinAxis, angle);
    rig.moving.forEach((object, index) => {
      object.quaternion.copy(rig.bases[index]!).premultiply(q);
    });
  } else if (rig.mode === "spear") {
    rig.moving.forEach((object) => { object.position.z = -rig.def.cells[1] * CELL * 0.18 - Math.max(0, angle); });
  } else if (rig.mode === "arm") {
    rig.moving.forEach((object) => { object.rotation.x = -angle; });
  } else if (rig.mode === "crusher") {
    rig.moving.forEach((object, index) => { object.rotation.z = (index === 0 ? -1 : 1) * angle * 0.46; });
  }
  const opacity = active ? THREE.MathUtils.clamp(Math.abs(omega) / Math.max(rig.def.maxOmega ?? 1, 1), 0, 1) * 0.34 : 0;
  for (const blur of rig.blurs) {
    (blur.material as THREE.MeshBasicMaterial).opacity = opacity;
    blur.visible = opacity > 0.025;
  }
}
