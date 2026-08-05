import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  type Object3D,
  type WebGPURenderer
} from "three/webgpu";
import {
  Fn,
  float,
  instanceIndex,
  mix,
  mx_noise_float,
  positionGeometry,
  storage,
  time,
  uniform,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { FIELD, cellSize, bladeCount, type GpuQuality } from "../field";

/**
 * A million blades of grass, laid out and blown about by compute shaders.
 *
 * ── the buffers, and why there are two rather than five ──────────────────
 *
 * WebGPU's default limit is EIGHT storage buffers per shader stage. The wind
 * kernel already binds the heightfield, the blade layout, the blade state and
 * the player trail; splitting position, height, rotation and colour into their
 * own buffers would have made eleven bindings — over the limit on every
 * device, and discovered at run time rather than here.
 *
 * So: one packed vec4 for the layout (x, groundY, z, height) and one for the
 * per-blade look (cos, sin, width, tint), written once; one vec4 of state
 * (bendX, bendZ, sway, flat) rewritten every frame. Nothing is uploaded from
 * the CPU at all.
 *
 * ⭐ THE ROOTS AND THE FEET COME FROM THE SAME BYTES
 *
 * The layout kernel samples the SAME storage buffer the terrain readback came
 * from, with the same bilinear weights heightAt() uses in field.ts. Not a
 * matching formula — the same numbers. A blade cannot float above the ground
 * the player walks on, because there is no second surface for it to float
 * above.
 */

export interface Grass {
  readonly mesh: InstancedMesh;
  readonly count: number;
  /** Runs the wind kernel. Called once per frame. */
  update(renderer: WebGPURenderer, playerX: number, playerZ: number, motionScale: number): void;
  dispose(): void;
}

/** Blade dimensions in metres. */
const BLADE = { height: 0.42, vary: 0.5, width: 0.022 } as const;
/** How far the walker flattens grass, and how hard. */
const PUSH = { radius: 1.15, strength: 0.85 } as const;

/**
 * The blade: five vertices, three triangles, tapering to a point.
 *
 * A quad would be two triangles and would look like a quad. The taper is what
 * makes a field of these read as grass rather than as a field of ribbons, and
 * it costs one extra triangle per blade — which at a million blades is a real
 * decision rather than a free one, and is why the count is only five.
 */
function bladeGeometry(): BufferGeometry {
  const position = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    -0.34, 0.55, 0,
    0.34, 0.55, 0,
    0, 1, 0
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  return geometry;
}

export async function buildGrass(
  renderer: WebGPURenderer,
  parent: Object3D,
  quality: GpuQuality,
  heightAttribute: StorageBufferAttribute
): Promise<Grass> {
  /* Built here rather than handed in, so the element type survives: a storage
     node typed through a parameter widens to "struct" and every .x on it stops
     compiling. */
  const heights = storage(heightAttribute, "float", FIELD.grid * FIELD.grid);
  const count = bladeCount(quality);
  const root = quality.bladeRoot;

  const layoutAttr = new StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
  const lookAttr = new StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
  const stateAttr = new StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
  const layout = storage(layoutAttr, "vec4", count);
  const look = storage(lookAttr, "vec4", count);
  const state = storage(stateAttr, "vec4", count);

  const player = uniform(vec2(0, 0));
  const wind = uniform(float(1));

  /* ── layout: once ─────────────────────────────────────────────────────── */
  const place = Fn(() => {
    const i = instanceIndex;
    const ix = i.mod(root).toFloat();
    const iz = i.div(root).toFloat();
    const spacing = float(FIELD.size / root);
    const half = float(FIELD.size / 2);
    /* Jittered off the lattice, or a million blades on a perfect grid moire
       into corduroy the moment the camera moves. */
    const jx = mx_noise_float(vec2(ix.mul(0.37), iz.mul(0.91))).mul(spacing).mul(0.85);
    const jz = mx_noise_float(vec2(ix.mul(0.71), iz.mul(0.29))).mul(spacing).mul(0.85);
    const x = ix.mul(spacing).sub(half).add(jx);
    const z = iz.mul(spacing).sub(half).add(jz);
    /*
     * The ground, sampled with the SAME bilinear weights heightAt() uses in
     * field.ts, out of the SAME buffer the readback came from. Inlined rather
     * than factored into a helper Fn because TSL's typed parameter list wants
     * VarNodes and the indirection bought nothing — it is used exactly once.
     */
    const step = float(cellSize());
    const halfF = float(FIELD.size / 2);
    const g = float(FIELD.grid);
    const maxI = float(FIELD.grid - 1);
    const fx = x.add(halfF).div(step);
    const fz = z.add(halfF).div(step);
    const x0 = fx.floor().clamp(0, maxI);
    const z0 = fz.floor().clamp(0, maxI);
    const x1 = x0.add(1).clamp(0, maxI);
    const z1 = z0.add(1).clamp(0, maxI);
    const tx = fx.sub(x0).clamp(0, 1);
    const tz = fz.sub(z0).clamp(0, 1);
    const h00 = heights.element(z0.mul(g).add(x0).toUint());
    const h10 = heights.element(z0.mul(g).add(x1).toUint());
    const h01 = heights.element(z1.mul(g).add(x0).toUint());
    const h11 = heights.element(z1.mul(g).add(x1).toUint());
    const y = mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);

    const varyN = mx_noise_float(vec2(x.mul(0.21), z.mul(0.21))).mul(0.5).add(0.5);
    const height = float(BLADE.height).mul(float(1 - BLADE.vary / 2).add(varyN.mul(BLADE.vary)));
    layout.element(i).assign(vec4(x, y, z, height));

    const angle = mx_noise_float(vec2(x.mul(1.7), z.mul(1.7))).mul(3.14159);
    look.element(i).assign(
      vec4(angle.cos(), angle.sin(), float(BLADE.width).mul(varyN.mul(0.5).add(0.75)), varyN)
    );
    state.element(i).assign(vec4(0, 0, 0, 0));
  })().compute(count);

  await renderer.computeAsync(place);

  /* ── wind: every frame ────────────────────────────────────────────────── */
  const blow = Fn(() => {
    const i = instanceIndex;
    const l = layout.element(i);
    const x = l.x;
    const z = l.z;

    /* Two scales again: a slow front crossing the field, and a fast ripple
       inside it. One scale alone reads as a fan pointed at the grass. */
    const t = time.mul(wind);
    const gust = mx_noise_float(vec2(x.mul(0.05).add(t.mul(0.35)), z.mul(0.05))).mul(0.6).add(0.6);
    const ripple = mx_noise_float(vec2(x.mul(0.55).add(t.mul(1.6)), z.mul(0.55).sub(t.mul(0.4))));
    const strength = gust.mul(0.55).add(ripple.mul(0.22)).mul(wind);

    /* The walker flattens what is under them. Radial, so the grass lies away
       from the feet rather than all one way. */
    const dx = x.sub(player.x);
    const dz = z.sub(player.y);
    const d = vec2(dx, dz).length().max(0.0001);
    const near = float(1).sub(d.div(PUSH.radius)).clamp(0, 1);
    const push = near.mul(near).mul(PUSH.strength);

    const bendX = strength.mul(0.75).add(dx.div(d).mul(push));
    const bendZ = strength.mul(0.32).add(dz.div(d).mul(push));
    state.element(i).assign(vec4(bendX, bendZ, push, 0));
  })().compute(count);

  /* ── the blades themselves ────────────────────────────────────────────── */
  const geometry = bladeGeometry();
  const material = new MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0 });

  material.positionNode = Fn(() => {
    const l = layout.element(instanceIndex);
    const k = look.element(instanceIndex);
    const s = state.element(instanceIndex);
    const local = positionGeometry;
    const up = local.y;
    /* Quadratic in height: a blade hinges at the root, it does not shear. */
    const lean = up.mul(up);
    const sideX = local.x.mul(k.z).mul(k.x);
    const sideZ = local.x.mul(k.z).mul(k.y);
    /* Pushed-down blades lose height as well as leaning, or a flattened patch
       reads as grass bent at a right angle rather than as grass trodden on. */
    const height = l.w.mul(float(1).sub(s.z.mul(0.55)));
    return vec3(
      l.x.add(sideX).add(s.x.mul(lean).mul(height)),
      l.y.add(up.mul(height)),
      l.z.add(sideZ).add(s.y.mul(lean).mul(height))
    );
  })();

  /* Darker at the root, brighter at the tip, varied per blade. Cheaper than a
     texture and it is what stops a million identical greens reading as felt. */
  material.colorNode = Fn(() => {
    const k = look.element(instanceIndex);
    const up = positionGeometry.y;
    const base = vec3(0.16, 0.24, 0.11);
    const tip = mix(vec3(0.44, 0.62, 0.26), vec3(0.62, 0.72, 0.33), k.w);
    return mix(base, tip, up.mul(up).mul(0.85).add(0.15));
  })();

  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);

  return {
    mesh,
    count,
    update(r, px, pz, motionScale) {
      player.value.set(px, pz);
      wind.value = motionScale;
      r.compute(blow);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
      mesh.dispose();
    }
  };
}
