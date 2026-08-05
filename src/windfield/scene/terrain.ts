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
import {
  Fn,
  float,
  instanceIndex,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  positionWorld,
  storage,
  vec2,
  vec3
} from "three/tsl";
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

    /*
     * ── the island ────────────────────────────────────────────────────────
     *
     * A radial profile multiplied into the noise, not added to it. Adding a
     * dome to FBM gives you a hill with the same roughness everywhere,
     * including out at sea where there is nothing to be rough; multiplying
     * makes the land carry the detail and the sea floor go quiet, which is
     * also what a real bathymetry looks like.
     *
     * The coastline is deliberately NOT a circle. `wobble` pushes the radius
     * in and out with angle, so the shore has bays and points instead of
     * reading as a coin dropped in a bath — and because it is a function of
     * the same x and z, the beach, the grass line and the water depth all
     * bend together without any of them being told about the others.
     */
    const r = vec2(x, z).length().div(FIELD.size * 0.5);
    const angle = z.atan(x);
    const wobble = angle
      .mul(3)
      .sin()
      .mul(0.055)
      .add(angle.mul(5).add(1.7).sin().mul(0.032))
      .add(angle.mul(2).sub(0.6).sin().mul(0.045));
    const shore = float(FIELD.shore).add(wobble);
    /* 1 well inside the shore, 0 well outside it. The two smoothstep edges are
       what make the beach a BAND rather than a line — the land tapers into the
       water over about four metres, which is where the foam and the wet sand
       will live. */
    const land = r.smoothstep(shore.add(0.1), shore.sub(0.22));

    /*
     * Height above sea level. The summit is `relief`, the rim is `-depth`, and
     * the waterline falls wherever `land` crosses the balance point — it is
     * never written down, which is why the beach cannot drift away from the
     * water when either constant is retuned.
     */
    const above = broad.mul(0.5).add(0.62).mul(FIELD.relief).add(fine.mul(FIELD.relief * 0.09));
    const below = float(FIELD.depth).mul(r.smoothstep(shore.sub(0.05), 1.05)).negate();
    const h = above.mul(land).add(below.mul(land.oneMinus()));
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

  /*
   * ── one surface, four materials ────────────────────────────────────────
   *
   * Sand at the waterline, grass above it, rock where it is too steep for
   * either, and wet sand in the band the water reaches. Blended in the shader
   * from the SAME height the walker stands on (positionWorld.y) and the same
   * normal the mesh was built with — not from a painted mask, which would be a
   * second description of where the beach is and would slide off it the first
   * time anyone retuned FIELD.shore.
   *
   * Roughness varies with the blend too. Wet sand is the only smooth thing on
   * the island and it is what makes the tideline read as wet rather than as a
   * darker sand.
   */
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  const groundBlend = Fn(() => {
    const h = positionWorld.y;
    const steep = normalWorld.y.oneMinus();
    /* Grain, so a 22 m beach is not one flat colour. */
    const grain = mx_fractal_noise_float(
      vec2(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9)),
      3,
      2,
      0.5,
      1
    )
      .mul(0.5)
      .add(0.5);

    const wetSand = vec3(0.28, 0.235, 0.19);
    const drySand = vec3(0.78, 0.71, 0.56);
    const turf = vec3(0.2, 0.3, 0.13);
    const rock = vec3(0.36, 0.34, 0.31);

    /* Underwater and the splash zone are wet; the dry beach runs from about
       ankle height to knee height above the water. */
    const sand = mix(wetSand, drySand, h.smoothstep(-0.15, 0.85));
    const withTurf = mix(sand, turf, h.smoothstep(0.7, 2.1));
    const withRock = mix(withTurf, rock, steep.smoothstep(0.26, 0.52));
    return withRock.mul(grain.mul(0.22).add(0.89));
  });
  material.colorNode = groundBlend();
  material.roughnessNode = Fn(() => {
    /* Wet sand reflects; dry sand and turf do not. */
    return float(0.42).add(positionWorld.y.smoothstep(-0.1, 0.9).mul(0.55));
  })();
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
