import {
  DoubleSide,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  StorageBufferAttribute,
  type Object3D
} from "three/webgpu";
import {
  Fn,
  float,
  max,
  mix,
  mx_noise_float,
  positionView,
  positionWorld,
  storage,
  time,
  uniform,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import type { Node } from "three/webgpu";
import { FIELD, cellSize } from "../field";

/**
 * The helpers below are plain functions that build nodes, not TSL `Fn`s.
 *
 * `Fn` with a typed parameter list wants VarNodes and refuses anything an
 * expression produced, which turns every call site into a cast. A JS function
 * that takes nodes and returns nodes composes into exactly the same shader
 * graph, inlined, with types that work.
 */
type F = Node<"float">;

/**
 * The sea.
 *
 * ── borrowed design, single definition ────────────────────────────────────
 *
 * The wave set, the shallow-to-deep colour ramp and the shoreline foam are
 * lifted from src/portfolio/gl/ocean.ts, which has been tuned against this
 * site's palette for two versions. That file is raw GLSL for WebGL and carries
 * a warning in its own header — "waveHeight() mirrors the vertex math in JS so
 * the ship can ride the surface... keep these in sync with the GLSL below."
 * Two implementations of one formula, held together by a comment.
 *
 * This one has no mirror. The height is written once, in TSL, and nothing on
 * the CPU needs it because the reader walks on land.
 *
 * ── ⭐ the depth comes from the island, not from a painted mask ───────────
 *
 * The water reads the SAME heightfield storage buffer the terrain compute
 * wrote and the walker's feet interpolate. Depth is just `-groundHeight`. So
 * the turquoise shallows, the foam band and the transparency all follow every
 * bay in the coast exactly, and they cannot drift from it, because there is
 * nothing else to drift from. Retune FIELD.shore and the beach, the grass line
 * and the surf move together without one line of code knowing about the others.
 *
 * ── why there is no second render pass ────────────────────────────────────
 *
 * The sky is already baked into scene.environment for the island's ambient. A
 * low-roughness MeshStandardNodeMaterial samples that for its reflection and
 * gets Fresnel from the standard BRDF for free — a planar reflector() would
 * draw the whole scene again for the reflection of an island you mostly cannot
 * see from the beach. The sun's specular comes from the same DirectionalLight
 * the land uses, so the glitter track always points where the shadows do.
 */

export interface Water {
  readonly mesh: Mesh;
  update(motionScale: number): void;
  dispose(): void;
}

/**
 * Four directional waves. Direction, amplitude, spatial frequency, speed.
 * Kept from ocean.ts: a long swell, a cross swell, and two short ones that
 * break the regularity up so the surface never reads as corrugated iron.
 */
const WAVES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  /* dirX, dirZ, amp, freq, speed */
  [0.9, 0.32, 0.2, 0.19, 0.9],
  [-0.5, 0.86, 0.13, 0.31, 1.15],
  [0.2, -0.98, 0.075, 0.52, 1.5],
  [-0.86, -0.5, 0.042, 0.85, 2.1]
];

/** How far the sea runs out. Past this it is fog, and then it is sky. */
const EXTENT = FIELD.size * 7;
/**
 * Vertices across. Nothing is displaced any more, so this only has to be dense
 * enough for vertex-interpolated fog — not for waves. See the note on the
 * position node below for why that distinction cost two renders to find.
 */
const SEGMENTS = 48;

export function buildWater(
  parent: Object3D,
  heightAttribute: StorageBufferAttribute
): Water {
  const heights = storage(heightAttribute, "float", FIELD.grid * FIELD.grid);
  const wind = uniform(float(1));

  /** Bilinear ground height, the same weights heightAt() uses in field.ts. */
  const groundAt = (x: F, z: F): F => {
    const step = float(cellSize());
    const half = float(FIELD.size / 2);
    const maxI = float(FIELD.grid - 1);
    const g = float(FIELD.grid);
    const fx = x.add(half).div(step);
    const fz = z.add(half).div(step);
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
    /* Outside the field there is no data, so the sea is simply deep. Without
       this the whole horizon would take the height of the nearest edge post
       and the far water would be one flat colour with a hard line at it. */
    const inside = x
      .abs()
      .max(z.abs())
      .step(float(FIELD.size / 2 - 0.6));
    return mix(float(-FIELD.depth * 1.6), mix(mix(h00, h10, tx), mix(h01, h11, tx), tz), inside);
  };

  /**
   * Surface height above sea level. Written once; there is no JS copy.
   *
   * `from` exists because of an aliasing bug that is worth naming. The mesh has
   * a vertex every 1.3 m and the fourth wave has a wavelength of 1.18 m — below
   * the sampling rate, so displacing geometry with it produced a field of
   * stationary blue diamonds instead of water. The geometry now carries only
   * the two long waves; all four are used for the NORMAL, which is evaluated
   * per fragment and cannot alias.
   */
  const waveAt = (x: F, z: F, from = 0): F => {
    const t = time.mul(wind);
    let sum: F = float(0);
    for (const [dx, dz, amp, freq, speed] of WAVES.slice(from === 0 ? 0 : 0, from === 0 ? 2 : 4)) {
      const len = Math.hypot(dx, dz);
      const phase = x
        .mul(dx / len)
        .add(z.mul(dz / len))
        .mul(freq * Math.PI * 2)
        .add(t.mul(speed));
      sum = sum.add(phase.sin().mul(amp));
    }
    return sum;
  };

  /* Two triangles would do. A few segments are kept only so the fog, which is
     interpolated per vertex on some paths, has somewhere to grade. */
  const geometry = new PlaneGeometry(EXTENT, EXTENT, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshStandardNodeMaterial({
    /* Low roughness so the baked sky is a reflection rather than a sheen, and
       zero metalness so the body colour below still shows through it. */
    roughness: 0.19,
    metalness: 0,
    transparent: true,
    side: DoubleSide
  });

  /*
   * ⭐ THE SURFACE IS FLAT. Every wave lives in the normal.
   *
   * The first two attempts displaced the plane. Both produced a field of
   * stationary blue diamonds stretching to the horizon, and the second one —
   * which dropped the two short waves out of the displacement — produced
   * exactly the same diamonds, which is what ruled out the short waves and
   * named the real cause: at 1.31 m between vertices even the SECOND wave, at
   * a 3.2 m wavelength, is only 2.5 samples per period. That is the Nyquist
   * limit; anything at or past it turns into a stationary interference
   * pattern rather than a wave.
   *
   * Raising the segment count would have fixed the second wave and moved the
   * problem to the third. Displacement is the wrong tool here: these waves are
   * 20 cm high seen from 2 m up across hundreds of metres, so the geometry
   * contributes almost nothing to the silhouette and everything to the alias.
   * The normal is evaluated per fragment and cannot alias — it is what the eye
   * was reading in the first place.
   */

  const surfaceNormal = () => {
    /* Central differences on the wave function itself. Analytic would be
       tidier; two extra evaluations is cheaper than writing the derivative of
       four phase-shifted sines twice and having them disagree. */
    const e = float(0.22);
    const x = positionWorld.x;
    const z = positionWorld.z;
    const dx = waveAt(x.add(e), z, 1).sub(waveAt(x.sub(e), z, 1)).div(e.mul(2));
    const dz = waveAt(x, z.add(e), 1).sub(waveAt(x, z.sub(e), 1)).div(e.mul(2));
    /*
     * ⭐ AND THE DIAMONDS WERE NOT ALIASING EITHER.
     *
     * Fading the normal with distance cleaned the horizon and left the lattice
     * intact from 20 to 140 m — which rules out both vertex spacing and pixel
     * footprint, and leaves only the obvious answer: four sine waves with fixed
     * directions ARE a regular interference pattern. The sea was drawing
     * exactly what it was asked for. Real water does not look like that
     * because real water is not four of anything.
     *
     * Two octaves of noise on the slope is what turns a lattice back into a
     * surface. It is added to the derivative rather than to the height so it
     * costs no extra evaluation of the wave sum.
     */
    const ripple = vec2(
      mx_noise_float(vec2(x.mul(0.9).add(time.mul(0.25)), z.mul(0.9))),
      mx_noise_float(vec2(x.mul(0.9).sub(31.7), z.mul(0.9).add(time.mul(0.21))))
    )
      .add(
        vec2(
          mx_noise_float(vec2(x.mul(2.7), z.mul(2.7).add(time.mul(0.6)))),
          mx_noise_float(vec2(x.mul(2.7).add(11.3), z.mul(2.7)))
        ).mul(0.45)
      )
      .mul(0.09);
    const full = vec3(dx.add(ripple.x).negate(), 1, dz.add(ripple.y).negate()).normalize();

    /*
     * ⭐ THE DIAMONDS, and what they actually were.
     *
     * Two renders were spent blaming vertex spacing: the plane was displaced,
     * then displaced with fewer waves, then flattened entirely — and the same
     * stationary blue diamond lattice came back every time, stretching to the
     * horizon. Flattening the plane is what proved it, because a flat plane
     * cannot alias geometrically. The pattern is in the FRAGMENT: a hundred
     * metres out, one pixel covers several metres of a wave 1.2 m long, and
     * point-sampling a sine at one place per pixel is a textbook moire.
     *
     * The fix is the same one mipmapping applies to textures — stop asking for
     * detail finer than a pixel. The normal fades toward flat with distance,
     * so the far sea becomes a mirror of the sky, which is exactly what the
     * sea looks like at the horizon anyway.
     */
    const detail = positionView.length().smoothstep(140, 22);
    return mix(vec3(0, 1, 0), full, detail).normalize();
  };
  material.normalNode = surfaceNormal();

  /* Depth below the surface at this pixel, in metres. Positive out at sea. */
  const depth = (): F => groundAt(positionWorld.x, positionWorld.z).negate().max(0);

  material.colorNode = Fn(() => {
    const d = depth();

    /* Turquoise where the sand is close enough to bounce light back, deep
       blue where nothing comes back at all. The exponent is absorption: the
       colour changes fastest in the first two metres, which is where a real
       lagoon does all of its work. */
    const shallow = vec3(0.22, 0.62, 0.6);
    const mid = vec3(0.05, 0.32, 0.46);
    const deep = vec3(0.012, 0.075, 0.19);
    const body = mix(mix(shallow, mid, d.smoothstep(0.15, 2.6)), deep, d.smoothstep(2.4, 8.5));

    /*
     * Foam, in two places a real shoreline has it.
     *
     * A band wherever the water is shallower than about half a metre — that is
     * the surf, and because `d` comes from the island's own heightfield it
     * traces every point and bay without a mask. And a fleck on the crest of
     * a wave anywhere, so the open sea is not glass. Noise breaks both into
     * pieces; an unbroken white line reads as a bug.
     */
    const surf = d.smoothstep(0.62, 0.06);
    /*
     * The crests, not the swell. Total amplitude is 0.45 m, so a threshold at
     * 0.14 was met by most of the sea most of the time and the whole surface
     * came back white — the render looked like a snowfield with a beach in it.
     * 0.33 to 0.42 is the top tenth.
     */
    const crest = waveAt(positionWorld.x, positionWorld.z, 1)
      .smoothstep(0.33, 0.42)
      .mul(positionView.length().smoothstep(140, 22));
    const fleck = mx_noise_float(
      vec2(positionWorld.x.mul(1.7).add(time.mul(0.35)), positionWorld.z.mul(1.7))
    )
      .mul(0.5)
      .add(0.5);
    const foam = max(surf.mul(fleck.mul(0.7).add(0.45)), crest.mul(fleck).mul(0.35)).clamp(0, 1);

    return mix(body, vec3(0.94, 0.97, 0.98), foam);
  })();

  /* Foam is not a mirror, and shallow water is not opaque. Both fall out of
     the same depth, so the tideline is one edge rather than three that nearly
     line up. */
  material.roughnessNode = Fn(() => {
    const d = depth();
    return float(0.17).add(d.smoothstep(0.7, 0.05).mul(0.5));
  })();
  material.opacityNode = Fn(() => {
    const d = depth();
    /* Nearly clear over wet sand, solid once the bottom is out of sight. */
    return float(0.28).add(d.smoothstep(0.05, 1.9).mul(0.7)).clamp(0, 1);
  })();

  /*
   * The glitter track, on the emissive channel so selective bloom picks it up
   * and nothing else does. This is the one thing in the scene allowed to be
   * brighter than white.
   */
  material.emissiveNode = Fn(() => {
    const n = surfaceNormal();
    /* Only the parts of the surface tilted toward the light sparkle. The
       standard BRDF already puts a specular highlight here; this is the extra
       that turns a highlight into a moving track of sun on water. */
    const sparkle = n.y.oneMinus().smoothstep(0.006, 0.055);
    const shimmer = mx_noise_float(
      vec2(
        positionWorld.x.mul(2.6).add(time.mul(0.9)),
        positionWorld.z.mul(2.6).sub(time.mul(0.6))
      )
    )
      .mul(0.5)
      .add(0.5);
    return vec4(vec3(1, 0.94, 0.82).mul(sparkle.mul(shimmer.mul(shimmer)).mul(0.7)), 1);
  })();

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  /* One flat surface the size of the world; culling it by its bounding box is
     a coin flip that sometimes removes the sea. */
  mesh.frustumCulled = false;
  /* After the opaque island, so the transparent shallows blend over the sand
     rather than over whatever was behind it. */
  mesh.renderOrder = 1;
  parent.add(mesh);

  return {
    mesh,
    update(motionScale: number) {
      /* Motion off stops the waves the way it stops the wind: the surface
         holds its shape rather than flattening, because a still sea is a
         photograph and a flat sea is a mistake. */
      wind.value = motionScale;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    }
  };
}
