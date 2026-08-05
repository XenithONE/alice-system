import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
  StorageBufferAttribute,
  Vector3,
  type Object3D,
  type WebGPURenderer
} from "three/webgpu";
import { Fn, float, instanceIndex, mx_fractal_noise_float, storage, vec2 } from "three/tsl";
import { FIELD, cellSize } from "../field";

/**
 * The ground: generated once on the GPU, read back once, and never computed
 * twice.
 *
 * ⭐ THE ONE FACT
 *
 * The fractal noise that shapes this field is written in exactly one place —
 * the compute kernel below. The CPU does not have its own copy of it and could
 * not run one: it reads the numbers the GPU produced. So the height the player
 * stands at, the height the grass grows from, and the height the ground is
 * drawn at all come from the same 262,144 floats. They cannot drift, because
 * there is nothing for them to drift from.
 *
 * The alternative — an FBM in JS and an FBM in WGSL that "match" — is the
 * defect this whole file is arranged to make impossible. Two implementations
 * of one formula agree until someone changes an octave count in one of them,
 * and then a player falls through a hill that is visibly there.
 *
 * ── why compute rather than a loop in JS ─────────────────────────────────
 *
 * 262,144 posts x 5 octaves is 1.3 million noise evaluations. In JS on the
 * main thread that is a visible freeze on load; as a dispatch it is under a
 * millisecond. The readback costs one await at boot and nothing afterwards.
 */

export interface Terrain {
  /** The heightfield, CPU-side. The single source of ground truth. */
  readonly field: Float32Array;
  /** The same data, still on the GPU, for the grass kernel to sample. */
  readonly attribute: StorageBufferAttribute;
  readonly mesh: Mesh;
  dispose(): void;
}

/** Metres of noise per unit. Two scales, so hills carry bumps. */
const BROAD = 0.016;
const FINE = 0.075;

export async function buildTerrain(renderer: WebGPURenderer, parent: Object3D): Promise<Terrain> {
  const posts = FIELD.grid * FIELD.grid;
  const attribute = new StorageBufferAttribute(new Float32Array(posts), 1);
  const heights = storage(attribute, "float", posts);

  const generate = Fn(() => {
    const ix = instanceIndex.mod(FIELD.grid).toFloat();
    const iz = instanceIndex.div(FIELD.grid).toFloat();
    const step = float(cellSize());
    const half = float(FIELD.size / 2);
    const x = ix.mul(step).sub(half);
    const z = iz.mul(step).sub(half);

    /* Two bands rather than one deep FBM: the broad one is the landform the
       reader walks over, the fine one is the texture that keeps a hillside
       from reading as a ramp. Adding octaves to a single band would have made
       the hills noisier without making them any more like hills. */
    const broad = mx_fractal_noise_float(vec2(x.mul(BROAD), z.mul(BROAD)), 4, 2, 0.5, 1);
    const fine = mx_fractal_noise_float(vec2(x.mul(FINE), z.mul(FINE)), 3, 2, 0.55, 1);
    const h = broad.mul(FIELD.relief * 0.5).add(fine.mul(FIELD.relief * 0.08));
    heights.element(instanceIndex).assign(h);
  })().compute(posts);

  await renderer.computeAsync(generate);
  const raw = await renderer.getArrayBufferAsync(attribute);
  const field = new Float32Array(raw);

  /* ── the visible ground ───────────────────────────────────────────────
   * Built from `field`, at `field`'s own resolution. Not a coarser mesh
   * sampling it: a 256-post mesh over a 512-post field would put the drawn
   * surface below the walked one on every convex ridge, by exactly the sag
   * the missing posts used to carry.
   */
  const n = FIELD.grid;
  const step = cellSize();
  const position = new Float32Array(posts * 3);
  const normal = new Float32Array(posts * 3);
  const uv = new Float32Array(posts * 2);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -FIELD.size / 2 + ix * step;
      const z = -FIELD.size / 2 + iz * step;
      position[i * 3] = x;
      position[i * 3 + 1] = field[i]!;
      position[i * 3 + 2] = z;
      uv[i * 2] = ix / (n - 1);
      uv[i * 2 + 1] = iz / (n - 1);
      /* Central differences on the grid itself, clamped at the border. Cheaper
         and more accurate than computeVertexNormals, which would average the
         two triangles of each quad and round off every ridge line. */
      const l = field[iz * n + Math.max(ix - 1, 0)]!;
      const r = field[iz * n + Math.min(ix + 1, n - 1)]!;
      const d = field[Math.max(iz - 1, 0) * n + ix]!;
      const u = field[Math.min(iz + 1, n - 1) * n + ix]!;
      const nx = (l - r) / (2 * step);
      const nz = (d - u) / (2 * step);
      const len = Math.hypot(nx, 1, nz);
      normal[i * 3] = nx / len;
      normal[i * 3 + 1] = 1 / len;
      normal[i * 3 + 2] = nz / len;
    }
  }

  /* 512 x 512 posts is 262,144 vertices — past the 65,536 a Uint16 index can
     reach, so the index buffer has to be 32-bit or every triangle past the
     first quarter of the field would point at the wrong vertex. */
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let w = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      index[w++] = a;
      index[w++] = a + n;
      index[w++] = a + 1;
      index[w++] = a + 1;
      index[w++] = a + n;
      index[w++] = a + n + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  const material = new MeshStandardNodeMaterial({
    color: "#5d7a44",
    roughness: 0.97,
    metalness: 0
  });
  const mesh = new Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  parent.add(mesh);

  return {
    field,
    attribute,
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    }
  };
}

/** Highest and lowest post, for the camera's clip planes and the gate. */
export function extremes(field: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const h of field) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

/** Somewhere flat to start, found rather than assumed. */
export function spawnPoint(field: Float32Array): Vector3 {
  const step = cellSize();
  let best = { x: 0, z: 0, slope: Infinity, h: 0 };
  for (let iz = 8; iz < FIELD.grid - 8; iz += 7) {
    for (let ix = 8; ix < FIELD.grid - 8; ix += 7) {
      const i = iz * FIELD.grid + ix;
      const dx = (field[i + 1]! - field[i - 1]!) / (2 * step);
      const dz = (field[i + FIELD.grid]! - field[i - FIELD.grid]!) / (2 * step);
      const slope = Math.hypot(dx, dz);
      const x = -FIELD.size / 2 + ix * step;
      const z = -FIELD.size / 2 + iz * step;
      /* Flat AND near the middle: the flattest post in the field is often in a
         corner, and starting a reader facing the edge of the world is a poor
         first impression of a world. */
      const bias = slope + Math.hypot(x, z) / FIELD.size;
      if (bias < best.slope) best = { x, z, slope: bias, h: field[i]! };
    }
  }
  return new Vector3(best.x, best.h, best.z);
}
