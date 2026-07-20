import * as THREE from "three";

// Flat-shaded low-poly ocean. A single large plane displaced by summed sine
// waves; the faceted look comes from computing the surface normal per-fragment
// from screen-space derivatives of the world position (so it faces correctly
// regardless of the plane's smooth vertex normals). Shallow->deep depth color,
// crest foam, shoreline foam rings around islands, and a hull wake. One draw
// call, zero textures. `waveHeight()` mirrors the vertex math in JS so the ship
// can ride the surface.

export const MAX_ISLANDS = 6;

export interface OceanUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uShallow: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uSky: { value: THREE.Color };
  uFoam: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uReveal: { value: number };
  uIslands: { value: THREE.Vector4[] }; // xz = center, w = shore radius
  uIslandCount: { value: number };
  uShip: { value: THREE.Vector3 }; // xz = pos, z-comp reused as wake strength
  uCursor: { value: THREE.Vector4 }; // xz = pos, z = strength, w unused
  uHoverPulse: { value: number };
}

export interface Ocean {
  mesh: THREE.Mesh;
  uniforms: OceanUniforms;
  /** Surface height at world (x, z) and time — matches the vertex shader. */
  waveHeight(x: number, z: number, time: number): number;
  dispose(): void;
}

// Four directional sine waves. Keep these in sync with the GLSL below.
const WAVES: Array<{ dir: [number, number]; amp: number; freq: number; speed: number }> = [
  { dir: [0.9, 0.32], amp: 0.42, freq: 0.19, speed: 0.9 },
  { dir: [-0.5, 0.86], amp: 0.28, freq: 0.31, speed: 1.15 },
  { dir: [0.2, -0.98], amp: 0.16, freq: 0.52, speed: 1.5 },
  { dir: [-0.86, -0.5], amp: 0.09, freq: 0.85, speed: 2.1 }
];

export function buildOcean(quality: { tier: "high" | "balanced" | "low" }): Ocean {
  const seg = quality.tier === "high" ? 168 : quality.tier === "balanced" ? 112 : 64;
  const geo = new THREE.PlaneGeometry(420, 420, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.72, 0.35).normalize() },
    uShallow: { value: new THREE.Color(0x49c5d0) },
    uDeep: { value: new THREE.Color(0x1e6ca6) },
    uSky: { value: new THREE.Color(0xd6f2ff) },
    uFoam: { value: new THREE.Color(0xf4faff) },
    uFogColor: { value: new THREE.Color(0xcdeaf6) },
    uFogNear: { value: 40 },
    uFogFar: { value: 210 },
    uReveal: { value: 0 },
    uIslands: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uIslandCount: { value: 0 },
    uShip: { value: new THREE.Vector3(0, 0, 0) },
    uCursor: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHoverPulse: { value: 0 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [k: string]: THREE.IUniform },
    // WebGL2 gives dFdx/fwidth in core; GLSL3 keeps it clean.
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uReveal;
      out vec3 vWorldPos;
      out float vHeight;
      out float vViewDist;

      const int NWAVES = 4;
      // dir.xy, amp, freq, speed packed per wave
      const vec4 W0 = vec4(0.9, 0.32, 0.42, 0.19);
      const vec4 W1 = vec4(-0.5, 0.86, 0.28, 0.31);
      const vec4 W2 = vec4(0.2, -0.98, 0.16, 0.52);
      const vec4 W3 = vec4(-0.86, -0.5, 0.09, 0.85);
      const vec4 S = vec4(0.9, 1.15, 1.5, 2.1);

      float waveOne(vec2 p, vec2 dir, float amp, float freq, float speed) {
        return amp * sin(dot(normalize(dir), p) * freq * 6.2831 + uTime * speed);
      }
      float heightAt(vec2 p) {
        float h = 0.0;
        h += waveOne(p, W0.xy, W0.z, W0.w, S.x);
        h += waveOne(p, W1.xy, W1.z, W1.w, S.y);
        h += waveOne(p, W2.xy, W2.z, W2.w, S.z);
        h += waveOne(p, W3.xy, W3.z, W3.w, S.w);
        return h;
      }

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float h = heightAt(world.xz);
        // Reveal: sea rises from a flat line as the page loads. uReveal is already
        // eased (smoothstep) JS-side, and the ship samples the same value, so apply
        // it linearly here to keep the hull exactly on the surface during load.
        h *= uReveal;
        world.y += h;
        vWorldPos = world.xyz;
        vHeight = h;
        vec4 viewPos = viewMatrix * world;
        vViewDist = -viewPos.z;
        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vWorldPos;
      in float vHeight;
      in float vViewDist;
      out vec4 fragColor;

      uniform vec3 uSunDir;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uFoam;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uTime;
      uniform vec4 uIslands[${MAX_ISLANDS}];
      uniform int uIslandCount;
      uniform vec3 uShip;
      uniform vec4 uCursor;
      uniform float uHoverPulse;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        // Per-fragment flat normal from world-position derivatives = true facets.
        vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (n.y < 0.0) n = -n;

        // Quantized lambert for the stylized banded look.
        float lam = max(dot(n, uSunDir), 0.0);
        float banded = floor(lam * 3.0 + 0.5) / 3.0;
        float diffuse = 0.55 + 0.45 * banded;

        // Depth color by wave height.
        float t = smoothstep(-0.35, 0.55, vHeight);
        vec3 col = mix(uDeep, uShallow, t);

        // Fresnel sky tint at grazing angles.
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.5);
        col *= diffuse;

        // Sun glint — kept tight and subtle so it sparkles without blowing out.
        vec3 refl = reflect(-uSunDir, n);
        float glint = pow(max(dot(refl, viewDir), 0.0), 96.0);
        col += glint * 0.22;

        // Foam accumulation.
        float foam = 0.0;
        // crest foam (only the sharpest crests)
        foam += smoothstep(0.42, 0.62, vHeight) * 0.7;
        // shoreline rings around islands
        for (int i = 0; i < ${MAX_ISLANDS}; i++) {
          if (i >= uIslandCount) break;
          vec4 isl = uIslands[i];
          float d = distance(vWorldPos.xz, isl.xy);
          float ring = 1.0 - smoothstep(isl.w * 0.72, isl.w * 1.18, d);
          ring *= smoothstep(isl.w * 1.35, isl.w * 1.0, d);
          foam += ring * 0.9;
        }
        // hull wake
        float shipD = distance(vWorldPos.xz, uShip.xy);
        foam += (1.0 - smoothstep(1.0, 4.2, shipD)) * 0.5;
        // hover pulse ring from the ship
        if (uHoverPulse > 0.001) {
          float r = uHoverPulse * 12.0;
          foam += (1.0 - smoothstep(0.0, 1.1, abs(shipD - r))) * uHoverPulse * 0.8;
        }
        // cursor wake
        if (uCursor.z > 0.001) {
          float cd = distance(vWorldPos.xz, uCursor.xy);
          foam += (1.0 - smoothstep(0.4, 2.4, cd)) * uCursor.z * 0.5;
        }
        // break foam into flecks with animated noise
        float fleck = vnoise(vWorldPos.xz * 1.4 + uTime * 0.25);
        foam *= 0.55 + 0.75 * fleck;
        foam = clamp(foam, 0.0, 1.0);
        col = mix(col, uFoam, foam);

        // Fog toward the horizon.
        float fog = smoothstep(uFogNear, uFogFar, vViewDist);
        col = mix(col, uFogColor, fog);

        fragColor = vec4(col, 1.0);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // one giant surface; never cull it
  mesh.renderOrder = 0;

  const waveHeight = (x: number, z: number, time: number): number => {
    let h = 0;
    for (const w of WAVES) {
      const len = Math.hypot(w.dir[0], w.dir[1]);
      const nx = w.dir[0] / len;
      const nz = w.dir[1] / len;
      h += w.amp * Math.sin((nx * x + nz * z) * w.freq * Math.PI * 2 + time * w.speed);
    }
    return h;
  };

  return {
    mesh,
    uniforms,
    waveHeight,
    dispose: () => {
      geo.dispose();
      material.dispose();
    }
  };
}
