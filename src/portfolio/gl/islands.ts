import * as THREE from "three";
import type { MachineMaterials } from "./machines/types";

// Low-poly islands: faceted landmass mounds with a sand skirt, scattered
// deterministically in a ring. Each island exposes its center + shore radius so
// the ocean shader can draw foam rings around it. Foliage/rocks are added
// separately (props/flora.ts) from the placements returned here.

export interface IslandPlacement {
  x: number;
  z: number;
  y: number; // top surface height for props to sit on
  scale: number;
  rot: number;
}

export interface Islands {
  group: THREE.Group;
  /** xz = center, w = shore radius — feed straight into the ocean uniform. */
  shores: THREE.Vector4[];
  /** where flora should be scattered (island tops). */
  placements: IslandPlacement[];
  dispose(): void;
}

const GRASS_TOP = 0x7cc64e;
const GRASS_LOW = 0x5aa63a;
const SAND = 0xf0dfa2;
const ROCK = 0x8b909b;

export function buildIslands(m: MachineMaterials, rand: () => number, count = 6): Islands {
  const group = new THREE.Group();
  const shores: THREE.Vector4[] = [];
  const placements: IslandPlacement[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  const grassMat = new THREE.MeshStandardMaterial({ color: GRASS_TOP, flatShading: true, roughness: 1, metalness: 0 });
  const grassLowMat = new THREE.MeshStandardMaterial({ color: GRASS_LOW, flatShading: true, roughness: 1, metalness: 0 });
  const sandMat = new THREE.MeshStandardMaterial({ color: SAND, flatShading: true, roughness: 1, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ color: ROCK, flatShading: true, roughness: 1, metalness: 0 });
  // v2 BRICK UPDATE — glossy toy-plastic accents for the cover-art lighthouse.
  const toyWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, flatShading: true, roughness: 0.35, metalness: 0 });
  const toyRedMat = new THREE.MeshStandardMaterial({ color: 0xc91a09, flatShading: true, roughness: 0.35, metalness: 0 });
  disposables.push(grassMat, grassLowMat, sandMat, rockMat, toyWhiteMat, toyRedMat);

  for (let i = 0; i < count; i += 1) {
    const ang = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    const radius = 30 + rand() * 58;
    const scale = 3.4 + rand() * 4.2;
    const cx = Math.cos(ang) * radius;
    const cz = Math.sin(ang) * radius;
    const island = new THREE.Group();
    island.position.set(cx, 0, cz);
    island.rotation.y = rand() * Math.PI * 2;

    // Landmass: a low icosahedron squashed flat, jittered for a natural rim.
    const landGeo = new THREE.IcosahedronGeometry(1, 2);
    jitter(landGeo, rand, 0.16);
    const land = new THREE.Mesh(landGeo, i % 3 === 0 ? grassLowMat : grassMat);
    land.scale.set(scale, scale * 0.42, scale);
    land.position.y = -scale * 0.14;
    land.castShadow = true;
    land.receiveShadow = true;
    island.add(land);
    disposables.push(landGeo);

    // Sand skirt: a slightly larger, flatter dome poking out under the grass.
    const sandGeo = new THREE.IcosahedronGeometry(1, 2);
    jitter(sandGeo, rand, 0.1);
    const sand = new THREE.Mesh(sandGeo, sandMat);
    sand.scale.set(scale * 1.22, scale * 0.26, scale * 1.22);
    sand.position.y = -scale * 0.2;
    sand.receiveShadow = true;
    island.add(sand);
    disposables.push(sandGeo);

    // A couple of chunky shore rocks per island.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    disposables.push(rockGeo);
    const rocks = 1 + Math.floor(rand() * 3);
    for (let r = 0; r < rocks; r += 1) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const ra = rand() * Math.PI * 2;
      const rr = scale * (0.9 + rand() * 0.35);
      const rs = 0.5 + rand() * 0.8;
      rock.position.set(Math.cos(ra) * rr, -scale * 0.05, Math.sin(ra) * rr);
      rock.scale.set(rs, rs * (0.7 + rand() * 0.5), rs);
      rock.rotation.set(rand(), rand() * Math.PI * 2, rand());
      rock.castShadow = true;
      island.add(rock);
    }

    // Hero island (first, largest-ish) gets a lighthouse landmark.
    if (i === 0) {
      island.add(buildLighthouse(m, scale * 0.5, toyWhiteMat, toyRedMat));
    }

    group.add(island);

    const shoreR = scale * 1.24;
    shores.push(new THREE.Vector4(cx, cz, 0, shoreR));
    placements.push({ x: cx, z: cz, y: scale * 0.18, scale, rot: island.rotation.y });
  }

  return {
    group,
    shores,
    placements,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    }
  };
}

/** Deterministic per-vertex jitter to break the perfect icosahedron. */
function jitter(geo: THREE.IcosahedronGeometry, rand: () => number, amount: number): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const s = 1 + (rand() - 0.5) * amount;
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();
}

/** A tiny striped low-poly lighthouse on the hero island.
 *  v2 BRICK UPDATE — restyled to the toy-brick cover art: white plastic tower
 *  with red stripe bands, dark gallery ring, red cone roof and a stud on top. */
function buildLighthouse(
  m: MachineMaterials,
  h: number,
  toyWhite: THREE.MeshStandardMaterial,
  toyRed: THREE.MeshStandardMaterial
): THREE.Group {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.16, h * 0.24, h * 1.4, 9), toyWhite);
  tower.position.y = h * 0.7;
  tower.castShadow = true;
  g.add(tower);
  // Two red stripe bands like the cover (lower band wider, upper band narrower).
  const bandLow = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.198, h * 0.218, h * 0.3, 9), toyRed);
  bandLow.position.y = h * 0.52;
  g.add(bandLow);
  const bandHigh = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.172, h * 0.186, h * 0.24, 9), toyRed);
  bandHigh.position.y = h * 1.1;
  g.add(bandHigh);
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.24, h * 0.24, h * 0.14, 9), m.iron);
  gallery.position.y = h * 1.42;
  g.add(gallery);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.15, h * 0.15, h * 0.24, 8), toyWhite);
  lamp.position.y = h * 1.56;
  g.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(h * 0.22, h * 0.3, 9), toyRed);
  roof.position.y = h * 1.78;
  roof.castShadow = true;
  g.add(roof);
  // Toy stud on the very tip.
  const tipStud = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.055, h * 0.055, h * 0.06, 8), toyRed);
  tipStud.position.y = h * 1.96;
  g.add(tipStud);
  return g;
}
