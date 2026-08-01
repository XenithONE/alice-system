/**
 * Low-poly ocean for the seaside circuit — a trimmed port of the atelier's
 * `portfolio/gl/ocean.ts` (four summed sine waves, dFdx facet normals, banded
 * lambert, fresnel, crest foam). Removed: island shoreline rings, hull wake,
 * cursor wake, hover pulse, reveal — a race track needs none of them. Changed:
 * fog is FogExp2 to match the kart scene (the original used linear fog and
 * would visibly disagree with the scenery at the horizon).
 *
 * `waveHeight()` still mirrors the GLSL so sailboats can ride the surface.
 * One draw call, zero textures.
 */

import * as THREE from "three";

export interface NkOceanColors {
  readonly shallow: number;
  readonly deep: number;
  readonly sky: number;
  readonly foam: number;
  readonly fog: number;
  readonly fogDensity: number;
  readonly sunDir: readonly [number, number, number];
}

export interface NkOcean {
  readonly mesh: THREE.Mesh;
  update(time: number): void;
  waveHeight(x: number, z: number, time: number): number;
  dispose(): void;
}

const WAVES: Array<{ dir: [number, number]; amp: number; freq: number; speed: number }> = [
  { dir: [0.9, 0.32], amp: 0.42, freq: 0.19, speed: 0.9 },
  { dir: [-0.5, 0.86], amp: 0.28, freq: 0.31, speed: 1.15 },
  { dir: [0.2, -0.98], amp: 0.16, freq: 0.52, speed: 1.5 },
  { dir: [-0.86, -0.5], amp: 0.09, freq: 0.85, speed: 2.1 },
];

export function buildNkOcean(
  size: number,
  segments: number,
  colors: NkOceanColors,
): NkOcean {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: {
      value: new THREE.Vector3(...colors.sunDir).normalize(),
    },
    uShallow: { value: new THREE.Color(colors.shallow) },
    uDeep: { value: new THREE.Color(colors.deep) },
    uSky: { value: new THREE.Color(colors.sky) },
    uFoam: { value: new THREE.Color(colors.foam) },
    uFogColor: { value: new THREE.Color(colors.fog) },
    uFogDensity: { value: colors.fogDensity },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      out vec3 vWorldPos;
      out float vHeight;
      out float vViewDist;

      const vec4 W0 = vec4(0.9, 0.32, 0.42, 0.19);
      const vec4 W1 = vec4(-0.5, 0.86, 0.28, 0.31);
      const vec4 W2 = vec4(0.2, -0.98, 0.16, 0.52);
      const vec4 W3 = vec4(-0.86, -0.5, 0.09, 0.85);
      const vec4 S = vec4(0.9, 1.15, 1.5, 2.1);

      float waveOne(vec2 p, vec2 dir, float amp, float freq, float speed) {
        return amp * sin(dot(normalize(dir), p) * freq * 6.2831 + uTime * speed);
      }

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float h = 0.0;
        h += waveOne(world.xz, W0.xy, W0.z, W0.w, S.x);
        h += waveOne(world.xz, W1.xy, W1.z, W1.w, S.y);
        h += waveOne(world.xz, W2.xy, W2.z, W2.w, S.z);
        h += waveOne(world.xz, W3.xy, W3.z, W3.w, S.w);
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
      uniform float uFogDensity;
      uniform float uTime;

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
        vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (n.y < 0.0) n = -n;

        float lam = max(dot(n, uSunDir), 0.0);
        float banded = floor(lam * 3.0 + 0.5) / 3.0;
        float diffuse = 0.55 + 0.45 * banded;

        float t = smoothstep(-0.35, 0.55, vHeight);
        vec3 col = mix(uDeep, uShallow, t);

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.5);
        col *= diffuse;

        vec3 refl = reflect(-uSunDir, n);
        float glint = pow(max(dot(refl, viewDir), 0.0), 96.0);
        col += glint * 0.22;

        float foam = smoothstep(0.42, 0.62, vHeight) * 0.7;
        float fleck = vnoise(vWorldPos.xz * 1.4 + uTime * 0.25);
        foam *= 0.55 + 0.75 * fleck;
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0));

        // FogExp2, matching the scene's — linear fog here visibly disagreed
        // with the scenery at the horizon in the first port.
        float f = vViewDist * uFogDensity;
        float fog = 1.0 - exp(-f * f);
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

        fragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1.9;

  return {
    mesh,
    update(time) {
      uniforms.uTime.value = time;
    },
    waveHeight(x, z, time) {
      let height = 0;
      for (const wave of WAVES) {
        const length = Math.hypot(wave.dir[0], wave.dir[1]);
        const nx = wave.dir[0] / length;
        const nz = wave.dir[1] / length;
        height +=
          wave.amp *
          Math.sin((nx * x + nz * z) * wave.freq * Math.PI * 2 + time * wave.speed);
      }
      return height;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
