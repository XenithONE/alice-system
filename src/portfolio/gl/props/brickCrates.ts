import * as THREE from "three";

// v2 "BRICK UPDATE" deck props — a few studded toy-brick cargo crates lashed on
// the caravel's deck, matching the toy-brick cover art (glossy plastic, 2x2 /
// 1x2 studs, toy palette). Purely decorative: the group is parented onto the
// ship so the crates ride the waves with it. Geometry is shared (one box, one
// stud cylinder) and every mesh is static — zero per-frame cost.

export interface BrickCrates {
  group: THREE.Group;
  dispose(): void;
}

// Toy plastic palette (cover: red hull accents, azure sea, yellow/green cargo).
const TOY_RED = 0xc91a09;
const TOY_AZURE = 0x3399ff;
const TOY_YELLOW = 0xf2cd37;
const TOY_GREEN = 0x4b9f4a;

export function buildBrickCrates(): BrickCrates {
  const group = new THREE.Group();
  group.name = "brick cargo crates";

  const box = new THREE.BoxGeometry(1, 1, 1);
  const stud = new THREE.CylinderGeometry(1, 1, 1, 10);

  const plastic = (color: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.32, metalness: 0 });
  const mats = {
    red: plastic(TOY_RED),
    azure: plastic(TOY_AZURE),
    yellow: plastic(TOY_YELLOW),
    green: plastic(TOY_GREEN)
  };

  /** One toy crate: cube body + a grid of studs on top, sitting on baseY. */
  function crate(
    mat: THREE.MeshStandardMaterial,
    x: number,
    baseY: number,
    z: number,
    size: number,
    studsX: number,
    studsZ: number,
    rotY = 0
  ): void {
    const holder = new THREE.Group();
    holder.position.set(x, baseY + size / 2, z);
    holder.rotation.y = rotY;

    const body = new THREE.Mesh(box, mat);
    body.scale.setScalar(size);
    holder.add(body);

    const sr = size * 0.16; // stud radius
    const sh = size * 0.12; // stud height
    for (let ix = 0; ix < studsX; ix += 1) {
      for (let iz = 0; iz < studsZ; iz += 1) {
        const s = new THREE.Mesh(stud, mat);
        s.scale.set(sr, sh, sr);
        s.position.set(
          (ix - (studsX - 1) / 2) * size * 0.46,
          size / 2 + sh / 2,
          (iz - (studsZ - 1) / 2) * size * 0.46
        );
        holder.add(s);
      }
    }
    group.add(holder);
  }

  // Deck top sits at y≈0.94; the quarterdeck top at y≈1.59 (see props/ship.ts).
  // Positions picked between the two machine pallets and clear of the barrels,
  // framed crates, rope coil, bulwark posts and lashing ropes.
  crate(mats.red, 0.66, 0.94, 0.38, 0.4, 2, 2, 0.14); // midship, starboard
  crate(mats.yellow, 0.66, 1.34, 0.38, 0.24, 2, 2, -0.1); // stacked on the red one
  crate(mats.azure, -0.68, 0.94, 0.6, 0.34, 2, 2, -0.18); // midship, port
  crate(mats.green, -0.52, 1.59, -2.38, 0.28, 1, 2, 0.2); // quarterdeck accent

  return {
    group,
    dispose: () => {
      box.dispose();
      stud.dispose();
      Object.values(mats).forEach((mm) => mm.dispose());
    }
  };
}
