import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createHarborSkiffModel } from "./generated/createHarborSkiffModel";

export type HarborQualityTier = "high" | "balanced" | "low";

export interface HarborMaterials {
  cream: THREE.MeshPhysicalMaterial;
  creamDark: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  cobalt: THREE.MeshPhysicalMaterial;
  teal: THREE.MeshPhysicalMaterial;
  terracotta: THREE.MeshPhysicalMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageDark: THREE.MeshStandardMaterial;
  wood: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshPhysicalMaterial;
  ivory: THREE.MeshPhysicalMaterial;
  window: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
}

export interface HarborFigure {
  root: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  head: THREE.Group;
}

export interface ProjectPortal {
  root: THREE.Group;
  pick: THREE.Mesh;
  frameMaterial: THREE.MeshStandardMaterial;
  coverMaterial: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function roundedBox(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  radius = 0.08
): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width * 0.15, height * 0.15, depth * 0.15));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createWindow(materials: HarborMaterials, width = 0.54, height = 1.05): THREE.Group {
  const root = new THREE.Group();
  const frame = roundedBox(width + 0.18, height + 0.18, 0.16, materials.brass, 0.045);
  root.add(frame);
  const light = roundedBox(width, height, 0.2, materials.window, 0.08);
  light.position.z = 0.03;
  root.add(light);
  const mullion = roundedBox(0.07, height * 0.86, 0.23, materials.brass, 0.025);
  mullion.position.z = 0.08;
  root.add(mullion);
  const cross = roundedBox(width * 0.84, 0.06, 0.23, materials.brass, 0.025);
  cross.position.z = 0.08;
  root.add(cross);
  return root;
}

function createRoof(
  material: THREE.Material,
  radius: number,
  height: number,
  tier: HarborQualityTier,
  brass: THREE.Material
): THREE.Group {
  const root = new THREE.Group();
  const segments = tier === "high" ? 12 : tier === "low" ? 8 : 10;
  const layers = tier === "low" ? 2 : 3;
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layer / Math.max(1, layers - 1);
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * (0.24 + t * 0.3), radius * (0.58 + t * 0.2), height / layers, segments, 1, false),
      material
    );
    cone.position.y = height - (layer + 0.5) * (height / layers);
    cone.castShadow = true;
    root.add(cone);
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.11, 10, 8), brass);
  finial.position.y = height + radius * 0.16;
  root.add(finial);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.04, radius * 0.06, radius * 0.34, 8), brass);
  pin.position.y = height + radius * 0.03;
  root.add(pin);
  return root;
}

function createTower(
  materials: HarborMaterials,
  tier: HarborQualityTier,
  roofMaterial: THREE.Material,
  height: number,
  radius: number
): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius, height, tier === "high" ? 16 : 12, tier === "high" ? 7 : 4),
    materials.cream
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const courses = tier === "low" ? 4 : 7;
  for (let i = 1; i < courses; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (0.93 + (i / courses) * 0.05), 0.055, 6, tier === "high" ? 32 : 20),
      materials.creamDark
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (i / courses) * height;
    root.add(ring);
  }

  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.18, radius * 1.12, 0.36, 16), materials.cream);
  balcony.position.y = height * 0.76;
  balcony.castShadow = true;
  root.add(balcony);

  const windowCount = tier === "low" ? 2 : 3;
  for (let i = 0; i < windowCount; i += 1) {
    const window = createWindow(materials, 0.46, 0.86);
    window.position.set(0, height * (0.34 + i * 0.2), radius * 0.93);
    root.add(window);
  }

  const battlements = tier === "low" ? 8 : 12;
  for (let i = 0; i < battlements; i += 1) {
    const angle = (i / battlements) * Math.PI * 2;
    const block = roundedBox(0.42, 0.45, 0.42, materials.cream, 0.045);
    block.position.set(Math.cos(angle) * radius * 0.98, height + 0.18, Math.sin(angle) * radius * 0.98);
    block.rotation.y = -angle;
    root.add(block);
  }

  const roof = createRoof(roofMaterial, radius * 1.04, radius * 1.75, tier, materials.brass);
  roof.position.y = height + 0.26;
  root.add(roof);
  return root;
}

export function createHarborMaterials(): HarborMaterials {
  const cream = new THREE.MeshPhysicalMaterial({
    color: 0xd8c39d,
    roughness: 0.67,
    clearcoat: 0.035,
    clearcoatRoughness: 0.55
  });
  const creamDark = new THREE.MeshStandardMaterial({ color: 0xb6a17f, roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x77808b, roughness: 0.93 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x4f5964, roughness: 0.96 });
  const roof = (color: number) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, clearcoat: 0.18, clearcoatRoughness: 0.28 });
  const window = new THREE.MeshStandardMaterial({
    color: 0xffba45,
    emissive: 0xff7b22,
    emissiveIntensity: 1.6,
    roughness: 0.34
  });
  return {
    cream,
    creamDark,
    stone,
    stoneDark,
    cobalt: roof(0x1767aa),
    teal: roof(0x138b88),
    terracotta: roof(0xa9472f),
    foliage: new THREE.MeshStandardMaterial({ color: 0x3a8f47, roughness: 0.86 }),
    foliageDark: new THREE.MeshStandardMaterial({ color: 0x1f6639, roughness: 0.9 }),
    wood: new THREE.MeshPhysicalMaterial({ color: 0x5b2e17, roughness: 0.5, clearcoat: 0.08 }),
    brass: new THREE.MeshPhysicalMaterial({
      color: 0xe0a73d,
      roughness: 0.24,
      metalness: 0.78,
      clearcoat: 0.22
    }),
    ivory: new THREE.MeshPhysicalMaterial({ color: 0xf4dfbc, roughness: 0.45, clearcoat: 0.08 }),
    window,
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffcb68,
      roughness: 0.12,
      transmission: 0.36,
      transparent: true,
      opacity: 0.78,
      emissive: 0xff8c2b,
      emissiveIntensity: 0.65
    })
  };
}

export function createCastleGate(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "castle-gate";

  const leftTower = createTower(materials, tier, materials.cobalt, 9.2, 2.1);
  leftTower.position.x = -3.4;
  root.add(leftTower);
  const rightTower = createTower(materials, tier, materials.cobalt, 9.2, 2.1);
  rightTower.position.x = 3.4;
  root.add(rightTower);

  const gateShape = new THREE.Shape();
  gateShape.moveTo(-3.2, 0);
  gateShape.lineTo(-3.2, 6.8);
  gateShape.lineTo(3.2, 6.8);
  gateShape.lineTo(3.2, 0);
  gateShape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-1.35, 0);
  opening.lineTo(-1.35, 2.4);
  opening.absarc(0, 2.4, 1.35, Math.PI, 0, true);
  opening.lineTo(1.35, 0);
  opening.closePath();
  gateShape.holes.push(opening);
  const gate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(gateShape, {
      depth: 1.45,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.08,
      bevelSegments: 2
    }),
    materials.cream
  );
  gate.position.z = -0.72;
  gate.castShadow = true;
  gate.receiveShadow = true;
  root.add(gate);

  const center = roundedBox(3.25, 3.3, 1.8, materials.cream, 0.12);
  center.position.set(0, 7.3, 0);
  root.add(center);
  const centerWindow = createWindow(materials, 0.8, 1.45);
  centerWindow.position.set(0, 7.45, 0.96);
  root.add(centerWindow);
  const centerRoof = createRoof(materials.terracotta, 1.9, 2.1, tier, materials.brass);
  centerRoof.position.y = 8.95;
  root.add(centerRoof);

  const tealCanopies = [-5.1, 5.1];
  for (const x of tealCanopies) {
    const porch = roundedBox(2.05, 2.55, 1.25, materials.cream, 0.1);
    porch.position.set(x, 1.65, 1.18);
    root.add(porch);
    const door = roundedBox(0.82, 1.72, 0.16, materials.wood, 0.25);
    door.position.set(x, 1.35, 1.86);
    root.add(door);
    const canopy = createRoof(materials.teal, 1.2, 1.15, tier, materials.brass);
    canopy.position.set(x, 2.92, 1.18);
    root.add(canopy);
  }

  const brickCount = tier === "low" ? 20 : 40;
  const brickGeo = new RoundedBoxGeometry(0.5, 0.26, 0.26, 2, 0.025);
  const accents = new THREE.InstancedMesh(brickGeo, materials.creamDark, brickCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < brickCount; i += 1) {
    const row = Math.floor(i / 10);
    const col = i % 10;
    dummy.position.set((col - 4.5) * 0.66, 0.4 + row * 1.42, 0.82 + (row % 2) * 0.02);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    accents.setMatrixAt(i, dummy.matrix);
  }
  accents.instanceMatrix.needsUpdate = true;
  root.add(accents);

  root.userData.landmark = "studio";
  return root;
}

export function createLighthouse(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "lighthouse";

  const rockCount = tier === "low" ? 9 : 18;
  for (let i = 0; i < rockCount; i += 1) {
    const angle = (i / rockCount) * Math.PI * 2;
    const radius = 1.25 + (i % 4) * 0.34;
    const rock = roundedBox(
      0.9 + (i % 3) * 0.24,
      0.65 + (i % 4) * 0.25,
      0.9 + ((i + 1) % 3) * 0.22,
      i % 3 === 0 ? materials.stoneDark : materials.stone,
      0.08
    );
    rock.position.set(Math.cos(angle) * radius, rock.geometry.boundingBox?.max.y ?? 0.35, Math.sin(angle) * radius);
    rock.position.y = 0.35 + (i % 4) * 0.12;
    rock.rotation.y = angle + (i % 2) * 0.18;
    root.add(rock);
  }

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.04, 1.46, 8.3, tier === "high" ? 20 : 14, tier === "high" ? 8 : 5),
    materials.cream
  );
  tower.position.y = 5.05;
  tower.castShadow = true;
  tower.receiveShadow = true;
  root.add(tower);

  for (const y of [3.25, 6.1]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.35 - y * 0.035, 1.38 - y * 0.035, 0.55, 16), materials.cobalt);
    band.position.y = y;
    band.castShadow = true;
    root.add(band);
  }

  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.28, 0.38, 18), materials.cream);
  balcony.position.y = 9.28;
  balcony.castShadow = true;
  root.add(balcony);
  const railingCount = tier === "low" ? 10 : 16;
  for (let i = 0; i < railingCount; i += 1) {
    const angle = (i / railingCount) * Math.PI * 2;
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 7), materials.cream);
    rail.position.set(Math.cos(angle) * 1.24, 9.72, Math.sin(angle) * 1.24);
    root.add(rail);
  }
  const railRing = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.055, 6, railingCount * 2), materials.cream);
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = 10.02;
  root.add(railRing);

  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 1.55, 10), materials.glass);
  lantern.position.y = 10.28;
  root.add(lantern);
  const glow = new THREE.PointLight(0xffb449, tier === "low" ? 5 : 12, 18, 2);
  glow.position.y = 10.3;
  root.add(glow);
  const roof = createRoof(materials.teal, 1.15, 1.55, tier, materials.brass);
  roof.position.y = 11.08;
  root.add(roof);

  const greenery = tier === "low" ? 5 : 11;
  for (let i = 0; i < greenery; i += 1) {
    const leaf = roundedBox(0.42, 0.18, 0.42, i % 3 === 0 ? materials.foliageDark : materials.foliage, 0.08);
    const angle = (i / greenery) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * (1.55 + (i % 2) * 0.35), 0.85 + (i % 3) * 0.14, Math.sin(angle) * 1.55);
    root.add(leaf);
  }
  root.userData.landmark = "ai-lab";
  return root;
}

export function createPromenade(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "promenade";
  const base = roundedBox(8.6, 0.72, 39, materials.cream, 0.14);
  base.position.set(-10.9, 0.12, -18.4);
  root.add(base);
  const seawall = roundedBox(1.1, 2.15, 39.5, materials.stone, 0.12);
  seawall.position.set(-6.9, -0.45, -18.4);
  root.add(seawall);

  const tileRows = tier === "low" ? 3 : 5;
  const tileCols = tier === "low" ? 18 : 32;
  const tileGeometry = new RoundedBoxGeometry(1.22, 0.18, 1.02, 2, 0.035);
  const tiles = new THREE.InstancedMesh(tileGeometry, materials.creamDark, tileRows * tileCols);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let row = 0; row < tileRows; row += 1) {
    for (let col = 0; col < tileCols; col += 1) {
      dummy.position.set(-14.45 + row * 1.55 + (col % 2) * 0.18, 0.56, -36.5 + col * 1.14);
      dummy.rotation.y = ((row + col) % 2) * 0.02;
      dummy.updateMatrix();
      tiles.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  tiles.receiveShadow = true;
  root.add(tiles);

  const bollards = tier === "low" ? 8 : 15;
  for (let i = 0; i < bollards; i += 1) {
    const post = roundedBox(0.38, 1.05, 0.38, materials.stoneDark, 0.055);
    post.position.set(-6.95, 1.15, -35.4 + i * (35 / Math.max(1, bollards - 1)));
    root.add(post);
    const cap = roundedBox(0.52, 0.17, 0.52, materials.brass, 0.05);
    cap.position.set(-6.95, 1.74, post.position.z);
    root.add(cap);
  }

  const dock = new THREE.Group();
  dock.name = "arrival-dock";
  for (let i = 0; i < 9; i += 1) {
    const plank = roundedBox(0.82, 0.2, 5.4, materials.wood, 0.045);
    plank.position.set(-6.3 + i * 0.84, 0.38, 1.05);
    dock.add(plank);
  }
  for (const x of [-6.5, 0.4]) {
    for (const z of [-1.05, 3.1]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.1, 8), materials.wood);
      pile.position.set(x, -0.24, z);
      dock.add(pile);
    }
  }
  root.add(dock);
  return root;
}

export function createMarket(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "prompt-market";
  const colors = [materials.cobalt, materials.teal, materials.terracotta];
  const count = tier === "low" ? 3 : 5;
  for (let i = 0; i < count; i += 1) {
    const stall = new THREE.Group();
    const counter = roundedBox(2.3, 0.32, 1.1, materials.wood, 0.05);
    counter.position.y = 1.15;
    stall.add(counter);
    for (const x of [-0.95, 0.95]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.35, 8), materials.wood);
      post.position.set(x, 1.4, 0);
      stall.add(post);
    }
    const canopy = roundedBox(2.55, 0.18, 1.55, colors[i % colors.length]!, 0.08);
    canopy.position.y = 2.45;
    canopy.rotation.z = (i % 2 ? 1 : -1) * 0.04;
    stall.add(canopy);
    stall.position.set(-17.1, 0.55, -4.5 - i * 5.5);
    stall.rotation.y = Math.PI / 2;
    root.add(stall);
  }
  root.userData.landmark = "prompts";
  return root;
}

export function createProjectPortal(
  texture: THREE.Texture,
  materials: HarborMaterials,
  tier: HarborQualityTier
): ProjectPortal {
  const root = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x70431f,
    roughness: 0.58,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const coverMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const back = roundedBox(2.72, 2.08, 0.22, frameMaterial, 0.07);
  back.position.y = 1.65;
  root.add(back);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 1.48), coverMaterial);
  cover.position.set(0, 1.68, 0.125);
  root.add(cover);
  const brassRule = roundedBox(2.52, 0.07, 0.12, materials.brass, 0.025);
  brassRule.position.set(0, 2.5, 0.16);
  root.add(brassRule);
  const legs = tier === "low" ? [-0.75, 0.75] : [-0.86, 0.86];
  for (const x of legs) {
    const leg = roundedBox(0.18, 1.5, 0.22, materials.wood, 0.035);
    leg.position.set(x, 0.5, 0);
    leg.rotation.z = x < 0 ? -0.08 : 0.08;
    root.add(leg);
  }
  const pick = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.7, 0.9),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pick.position.y = 1.55;
  root.add(pick);
  return {
    root,
    pick,
    frameMaterial,
    coverMaterial,
    dispose() {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
      });
      frameMaterial.dispose();
      coverMaterial.dispose();
      (pick.material as THREE.Material).dispose();
    }
  };
}

export function createBlockFigure(materials: HarborMaterials): HarborFigure {
  const root = new THREE.Group();
  root.name = "harbor-explorer";
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x1767aa, roughness: 0.42, clearcoat: 0.08 });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xe3ad5d, roughness: 0.46, clearcoat: 0.06 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x5a2b18, roughness: 0.82 });

  const torso = roundedBox(0.88, 1.02, 0.48, blue, 0.09);
  torso.position.y = 1.72;
  root.add(torso);
  const belt = roundedBox(0.92, 0.16, 0.52, materials.brass, 0.04);
  belt.position.y = 1.25;
  root.add(belt);

  const head = new THREE.Group();
  head.position.y = 2.56;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.52, 16), skin);
  head.add(face);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.41, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMaterial);
  hair.position.y = 0.3;
  head.add(hair);
  root.add(head);

  const limb = (material: THREE.Material, length: number, width: number) => {
    const pivot = new THREE.Group();
    const mesh = roundedBox(width, length, width, material, 0.07);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    return pivot;
  };
  const leftArm = limb(skin, 0.86, 0.28);
  leftArm.position.set(-0.58, 2.08, 0);
  root.add(leftArm);
  const rightArm = limb(skin, 0.86, 0.28);
  rightArm.position.set(0.58, 2.08, 0);
  root.add(rightArm);
  const leftLeg = limb(blue, 0.92, 0.36);
  leftLeg.position.set(-0.24, 1.16, 0);
  root.add(leftLeg);
  const rightLeg = limb(blue, 0.92, 0.36);
  rightLeg.position.set(0.24, 1.16, 0);
  root.add(rightLeg);

  root.scale.setScalar(0.72);
  root.userData.materials = [blue, skin, hairMaterial];
  return { root, leftArm, rightArm, leftLeg, rightLeg, head };
}

export function createCityBackdrop(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  root.name = "city-backdrop";
  const count = tier === "low" ? 8 : tier === "high" ? 18 : 13;
  const palette = [materials.cobalt, materials.teal, materials.terracotta];
  for (let i = 0; i < count; i += 1) {
    const x = -24 + (i % 6) * 6.6 + (i % 2) * 1.3;
    const z = -29 - Math.floor(i / 6) * 8.5 - (i % 3) * 1.2;
    const height = 4.5 + (i % 4) * 1.3;
    const radius = 1.05 + (i % 3) * 0.24;
    const tower = createTower(materials, "low", palette[i % palette.length]!, height, radius);
    tower.position.set(x, 0.2, z);
    tower.scale.setScalar(0.82 + (i % 3) * 0.08);
    root.add(tower);
  }
  return root;
}

export function createFloatingIslands(materials: HarborMaterials, tier: HarborQualityTier): THREE.Group {
  const root = new THREE.Group();
  const count = tier === "low" ? 2 : 4;
  for (let i = 0; i < count; i += 1) {
    const island = new THREE.Group();
    const rockGeometry = new THREE.ConeGeometry(
      1.8 + i * 0.2,
      3.8 + i * 0.35,
      tier === "high" ? 9 : 7,
      4
    );
    const rockPositions = rockGeometry.attributes.position as THREE.BufferAttribute;
    const rockRadius = 1.8 + i * 0.2;
    for (let vertex = 0; vertex < rockPositions.count; vertex += 1) {
      const x = rockPositions.getX(vertex);
      const y = rockPositions.getY(vertex);
      const z = rockPositions.getZ(vertex);
      const radius = Math.hypot(x, z);
      if (radius < 0.08) continue;
      const angle = Math.atan2(z, x);
      const taper = THREE.MathUtils.clamp(radius / rockRadius, 0.2, 1);
      const jitter = 1 + Math.sin(angle * 3 + i * 1.7 + y * 1.8) * 0.13 * taper;
      rockPositions.setXYZ(vertex, x * jitter, y + Math.cos(angle * 2 + y) * 0.08, z * jitter);
    }
    rockPositions.needsUpdate = true;
    rockGeometry.computeVertexNormals();
    const rock = new THREE.Mesh(
      rockGeometry,
      materials.stoneDark
    );
    rock.rotation.z = Math.PI;
    rock.position.y = -1.8;
    island.add(rock);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.75 + i * 0.2, 1.45 + i * 0.16, 0.58, 9), materials.foliage);
    top.position.y = 0.15;
    island.add(top);
    const shrine = createTower(materials, "low", i % 2 ? materials.teal : materials.cobalt, 2.6, 0.55);
    shrine.scale.setScalar(0.55);
    shrine.position.y = 0.42;
    island.add(shrine);
    island.position.set(14 + i * 9, 17 + (i % 2) * 5, -39 - i * 8);
    island.scale.setScalar(0.82 + i * 0.08);
    root.add(island);
  }
  return root;
}

export function createPlayableSkiff(tier: HarborQualityTier, castShadow: boolean) {
  return createHarborSkiffModel({ quality: tier, castShadow });
}

export function disposeHarborObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    source.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const customMaterials = root.userData.materials;
  if (Array.isArray(customMaterials)) {
    customMaterials.forEach((material) => {
      if (material && typeof material.dispose === "function") material.dispose();
    });
  }
}
