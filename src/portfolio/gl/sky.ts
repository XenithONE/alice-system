import * as THREE from "three";

// Low-poly sky furniture: a gradient dome, an emissive sun (bloom target),
// drifting faceted cloud clusters, and a flock of V-shaped birds. All flat /
// unlit where appropriate so it reads as the stylized world's backdrop.

export interface Sky {
  group: THREE.Group;
  sun: THREE.Mesh;
  setPalette(top: THREE.Color, horizon: THREE.Color, sunColor: THREE.Color): void;
  update(time: number, motion: number): void;
  dispose(): void;
}

export function buildSky(quality: { tier: "high" | "balanced" | "low" }): Sky {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // ---- gradient dome -------------------------------------------------------
  const domeGeo = new THREE.IcosahedronGeometry(300, 3);
  const domeUniforms = {
    uTop: { value: new THREE.Color(0x5fbff0) },
    uHorizon: { value: new THREE.Color(0xd6f2ff) }
  };
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: domeUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying vec3 vPos;
      void main() {
        float h = clamp(normalize(vPos).y * 1.15 + 0.15, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.9, h)), 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  group.add(dome);
  disposables.push(domeGeo, domeMat);

  // ---- sun -----------------------------------------------------------------
  const sunGeo = new THREE.IcosahedronGeometry(7, 2);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4c6, fog: false, toneMapped: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(90, 78, -150);
  sun.frustumCulled = false;
  group.add(sun);
  disposables.push(sunGeo, sunMat);
  // soft halo
  const haloGeo = new THREE.IcosahedronGeometry(12, 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff0b0,
    transparent: true,
    opacity: 0.28,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(sun.position);
  group.add(halo);
  disposables.push(haloGeo, haloMat);

  // ---- clouds --------------------------------------------------------------
  const cloudCount = quality.tier === "low" ? 5 : 9;
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    fog: false,
    emissive: 0xdfeefc,
    emissiveIntensity: 0.35
  });
  disposables.push(cloudGeo, cloudMat);
  const cloudGroup = new THREE.Group();
  const cloudSeeds: number[] = [];
  for (let i = 0; i < cloudCount; i += 1) {
    const cluster = new THREE.Group();
    const s = ((i * 73) % 17) / 17;
    const puffs = 3 + ((i * 3) % 3);
    for (let p = 0; p < puffs; p += 1) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const t = p / puffs;
      puff.position.set((t - 0.4) * 7 + Math.sin(i + p) * 1.4, Math.cos(i * 2 + p) * 1.1, Math.sin(i * 3 + p) * 2);
      puff.scale.set(3.2 + s * 2 - Math.abs(t - 0.5) * 3, 1.7 + s, 2.4 + s);
      cluster.add(puff);
    }
    const ang = (i / cloudCount) * Math.PI * 2 + s;
    const rad = 90 + s * 70;
    cluster.position.set(Math.cos(ang) * rad, 42 + s * 26, Math.sin(ang) * rad - 30);
    cloudGroup.add(cluster);
    cloudSeeds.push(s);
  }
  group.add(cloudGroup);

  // ---- birds ---------------------------------------------------------------
  const birdCount = quality.tier === "low" ? 6 : 14;
  const birdGeo = makeBirdGeometry();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2b2f3a, fog: false, side: THREE.DoubleSide });
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
  birds.frustumCulled = false;
  group.add(birds);
  disposables.push(birdGeo, birdMat);
  const birdScratch = new THREE.Object3D();
  const birdData: Array<{ radius: number; height: number; phase: number; speed: number }> = [];
  for (let i = 0; i < birdCount; i += 1) {
    const s = i / birdCount;
    birdData.push({ radius: 26 + s * 40, height: 30 + s * 22, phase: s * Math.PI * 2, speed: 0.05 + s * 0.04 });
  }

  const setPalette = (top: THREE.Color, horizon: THREE.Color, sunColor: THREE.Color): void => {
    domeUniforms.uTop.value.copy(top);
    domeUniforms.uHorizon.value.copy(horizon);
    sunMat.color.copy(sunColor);
    haloMat.color.copy(sunColor);
  };

  const update = (time: number, motion: number): void => {
    // drifting clouds (frozen at motion=0 but composed)
    for (let i = 0; i < cloudGroup.children.length; i += 1) {
      const c = cloudGroup.children[i];
      const s = cloudSeeds[i];
      const base = (i / cloudCount) * Math.PI * 2 + s;
      const ang = base + time * motion * (0.008 + s * 0.006);
      const rad = 90 + s * 70;
      c.position.x = Math.cos(ang) * rad;
      c.position.z = Math.sin(ang) * rad - 30;
    }
    // circling, flapping birds
    for (let i = 0; i < birdCount; i += 1) {
      const b = birdData[i];
      const a = b.phase + time * motion * b.speed + b.phase;
      const x = Math.cos(a) * b.radius - 20;
      const z = Math.sin(a) * b.radius - 40;
      birdScratch.position.set(x, b.height + Math.sin(time * motion + b.phase) * 1.5, z);
      birdScratch.rotation.set(0, -a + Math.PI / 2, 0);
      const flap = 0.5 + Math.sin(time * motion * 6 + b.phase) * 0.35;
      birdScratch.scale.set(1.3, flap + 0.3, 1);
      birdScratch.updateMatrix();
      birds.setMatrixAt(i, birdScratch.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;
  };

  update(0, 0);

  return {
    group,
    sun,
    setPalette,
    update,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    }
  };
}

/** A simple V (two triangles) seen from above — a distant bird silhouette. */
function makeBirdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0, -1, 0.18, -0.5, -0.9, 0, -0.2,
    0, 0, 0, 0.9, 0, -0.2, 1, 0.18, -0.5
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
