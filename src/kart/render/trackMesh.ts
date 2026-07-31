/**
 * The circuit, built from the same `Track` the simulation drives on.
 *
 * SCRAP CROWN shipped an arena whose walls and colliders came from two
 * different loops; they agreed at high detail and were 0.747 m apart at low, so
 * low-spec machines drove through the wall. Every band below is generated from
 * `track.samples` and `surfaceHeight` — the same two things `querySurface`
 * answers with — and renderSelftest [R2] measures the agreement rather than
 * trusting this comment.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../lib/seed";
import { SHOULDER_WIDTH } from "../sim/balance";
import { surfaceHeight, type Track } from "../sim/track";
import {
  asphaltTexture,
  boostPadTexture,
  checkerTexture,
  groundTexture,
  itemBoxTexture,
  rumbleTexture,
} from "./textures";

export interface TrackMeshQuality {
  readonly shadows: boolean;
  /** 1 = every prop, 0.4 = a distant-only skeleton. */
  readonly propDensity: number;
}

export interface TrackMeshBundle {
  readonly group: THREE.Group;
  readonly itemBoxes: readonly THREE.Object3D[];
  update(elapsed: number, boxCooldowns: readonly number[]): void;
  /** Road edge as the MESH built it — renderSelftest compares it to the sim. */
  edgeAt(index: number, side: -1 | 1): readonly [number, number, number];
  dispose(): void;
}

const RUMBLE_WIDTH = SHOULDER_WIDTH;
const APRON_INNER = 8;
const APRON_OUTER = 48;
const APRON_DROP_INNER = 1.2;
const APRON_DROP_OUTER = 10;

/**
 * One side band of the circuit.
 *
 * `from`/`to` are metres OUTSIDE the road edge, so a band automatically
 * follows a road that widens into a corner. `from = -x` reaches back onto the
 * tarmac, which is how the edge line is drawn.
 */
function lateralBand(
  track: Track,
  side: 1 | -1,
  from: number,
  to: number,
  vScale = 12,
  liftFrom = 0,
  liftTo = 0,
): THREE.BufferGeometry {
  const samples = track.samples;
  const count = samples.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    const sample = samples[i % count]!;
    const inner = side * (sample.half + from);
    const outer = side * (sample.half + to);
    positions.push(
      sample.x + sample.rx * inner,
      surfaceHeight(sample, inner) + liftFrom,
      sample.z + sample.rz * inner,
      sample.x + sample.rx * outer,
      surfaceHeight(sample, outer) + liftTo,
      sample.z + sample.rz * outer,
    );
    const v = (i * track.step) / vScale;
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < count; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    if (side === 1) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  faceUp(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Make a ground band's normals point at the sky.
 *
 * The two sides of the circuit are mirror images, so one of them comes out
 * wound the other way and `computeVertexNormals` gives it downward normals.
 * The result is not an obviously broken image — it is a verge that is simply
 * never lit by the sun, on one side of the track only, which reads as "the
 * grass is a bit dark over there" rather than as a bug.
 */
function faceUp(geometry: THREE.BufferGeometry): void {
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  let sum = 0;
  for (let i = 0; i < normals.count; i += 1) sum += normals.getY(i);
  if (sum >= 0) return;
  const index = geometry.getIndex()!;
  const array = index.array as Uint32Array | Uint16Array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1]!;
    array[i + 1] = array[i + 2]!;
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function bothSides(
  track: Track,
  from: number,
  to: number,
  vScale?: number,
  liftFrom?: number,
  liftTo?: number,
): THREE.BufferGeometry {
  const parts = ([1, -1] as const).map((side) =>
    lateralBand(track, side, from, to, vScale, liftFrom, liftTo),
  );
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return merged;
}

/** The tarmac itself: a band spanning −half..+half with lanes across it. */
export function roadGeometry(track: Track): THREE.BufferGeometry {
  const samples = track.samples;
  const count = samples.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const across = 6;
  for (let i = 0; i <= count; i += 1) {
    const sample = samples[i % count]!;
    for (let j = 0; j <= across; j += 1) {
      const t = j / across;
      const lateral = (t * 2 - 1) * sample.half;
      positions.push(
        sample.x + sample.rx * lateral,
        surfaceHeight(sample, lateral),
        sample.z + sample.rz * lateral,
      );
      uvs.push(t, (i * track.step) / 14);
    }
  }
  const stride = across + 1;
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < across; j += 1) {
      const a = i * stride + j;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  faceUp(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

interface Piece {
  dispose(): void;
}

function railPieces(
  track: Track,
  color: number,
  quality: TrackMeshQuality,
): { object: THREE.Object3D; pieces: Piece[] } {
  const group = new THREE.Group();
  const spacing = Math.max(3, Math.round(9 / track.step));
  const postGeometry = new THREE.BoxGeometry(0.34, 1.5, 0.34);
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0x6d7480,
    roughness: 0.7,
    metalness: 0.5,
  });
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < track.samples.length; i += spacing) {
    const sample = track.samples[i]!;
    for (const side of [1, -1] as const) {
      const lateral = side * (sample.half + RUMBLE_WIDTH + 0.55);
      dummy.position.set(
        sample.x + sample.rx * lateral,
        surfaceHeight(sample, lateral) + 0.7,
        sample.z + sample.rz * lateral,
      );
      dummy.rotation.set(0, Math.atan2(sample.tx, sample.tz), 0);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
  }
  const posts = new THREE.InstancedMesh(
    postGeometry,
    postMaterial,
    matrices.length,
  );
  matrices.forEach((matrix, index) => posts.setMatrixAt(index, matrix));
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = quality.shadows;
  posts.frustumCulled = false;
  group.add(posts);

  const barrierGeometry = bothSides(
    track,
    RUMBLE_WIDTH + 0.35,
    RUMBLE_WIDTH + 0.8,
    6,
    1.35,
    1.0,
  );
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.32,
    emissive: new THREE.Color(color).multiplyScalar(0.07),
    side: THREE.DoubleSide,
  });
  const barrier = new THREE.Mesh(barrierGeometry, barrierMaterial);
  group.add(barrier);

  return {
    object: group,
    pieces: [
      { dispose: () => postGeometry.dispose() },
      { dispose: () => postMaterial.dispose() },
      { dispose: () => posts.dispose() },
      { dispose: () => barrierGeometry.dispose() },
      { dispose: () => barrierMaterial.dispose() },
    ],
  };
}

function propPieces(
  track: Track,
  quality: TrackMeshQuality,
): { object: THREE.Object3D; pieces: Piece[] } {
  const theme = track.spec.theme;
  const group = new THREE.Group();
  const pieces: Piece[] = [];
  const random = mulberry32(0x4b17 ^ track.samples.length);
  const spacing = Math.max(
    4,
    Math.round(track.samples.length / (46 * quality.propDensity)),
  );

  const slots: { x: number; y: number; z: number; yaw: number; scale: number }[] =
    [];
  for (let i = 0; i < track.samples.length; i += spacing) {
    const sample = track.samples[i]!;
    for (const side of [1, -1] as const) {
      if (random() < 0.2) continue;
      const out = RUMBLE_WIDTH + 5 + random() * 24;
      const lateral = side * (sample.half + out);
      const dropT = Math.min(
        1,
        Math.max(0, (out - APRON_INNER) / (APRON_OUTER - APRON_INNER)),
      );
      slots.push({
        x: sample.x + sample.rx * lateral,
        y:
          surfaceHeight(sample, lateral) -
          (APRON_DROP_INNER +
            dropT * (APRON_DROP_OUTER - APRON_DROP_INNER)),
        z: sample.z + sample.rz * lateral,
        yaw: random() * Math.PI * 2,
        scale: 0.75 + random() * 0.75,
      });
    }
  }

  const place = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    lift: number,
    castShadow = true,
  ): void => {
    const mesh = new THREE.InstancedMesh(geometry, material, slots.length);
    const dummy = new THREE.Object3D();
    slots.forEach((slot, index) => {
      dummy.position.set(slot.x, slot.y + lift * slot.scale, slot.z);
      dummy.rotation.set(0, slot.yaw, 0);
      dummy.scale.setScalar(slot.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = quality.shadows && castShadow;
    mesh.frustumCulled = false;
    group.add(mesh);
    pieces.push({
      dispose: () => {
        geometry.dispose();
        material.dispose();
        mesh.dispose();
      },
    });
  };

  if (theme.props === "palm") {
    place(
      new THREE.CylinderGeometry(0.22, 0.44, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0x7d5a36, roughness: 0.92 }),
      3.5,
    );
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i += 1) {
      const frond = new THREE.ConeGeometry(0.55, 4.6, 4, 1, true);
      frond.rotateZ(Math.PI / 2.3);
      frond.translate(2.1, 0, 0);
      frond.rotateY((i / 6) * Math.PI * 2);
      fronds.push(frond.toNonIndexed());
    }
    const crown = mergeGeometries(fronds)!;
    for (const frond of fronds) frond.dispose();
    place(
      crown,
      new THREE.MeshStandardMaterial({
        color: 0x2f8f4a,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
      7,
    );
  } else if (theme.props === "neon") {
    place(
      new THREE.CylinderGeometry(0.3, 0.44, 9.5, 5),
      new THREE.MeshStandardMaterial({
        color: 0x191325,
        roughness: 0.5,
        metalness: 0.65,
      }),
      4.75,
    );
    const ring = new THREE.TorusGeometry(1.6, 0.17, 6, 20);
    ring.rotateX(Math.PI / 2);
    place(
      ring,
      new THREE.MeshBasicMaterial({
        color: theme.groundAccent,
        toneMapped: false,
      }),
      9.4,
      false,
    );
    place(
      new THREE.BoxGeometry(0.16, 6.8, 0.16),
      new THREE.MeshBasicMaterial({ color: theme.roadEdge, toneMapped: false }),
      4.4,
      false,
    );
  } else {
    place(
      new THREE.CylinderGeometry(0.32, 0.46, 2.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.95 }),
      1.3,
    );
    place(
      new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.MeshStandardMaterial({
        color: 0x2f7d3c,
        roughness: 0.85,
        flatShading: true,
      }),
      4.2,
    );
  }

  return { object: group, pieces };
}

export function buildTrackMesh(
  track: Track,
  quality: TrackMeshQuality,
): TrackMeshBundle {
  const theme = track.spec.theme;
  const group = new THREE.Group();
  group.name = `track:${track.spec.id}`;
  const pieces: Piece[] = [];

  // ── Tarmac ────────────────────────────────────────────────────────────────
  const roadMap = asphaltTexture(theme.road, 1);
  const roadGeo = roadGeometry(track);
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadMap,
    roughness: 0.87,
    metalness: 0.05,
  });
  const road = new THREE.Mesh(roadGeo, roadMaterial);
  road.receiveShadow = quality.shadows;
  group.add(road);
  pieces.push(
    { dispose: () => roadGeo.dispose() },
    { dispose: () => roadMaterial.dispose() },
    { dispose: () => roadMap.dispose() },
  );

  // ── Edge line, just inside the drivable width ─────────────────────────────
  const lineGeo = bothSides(track, -0.6, -0.1, 6, 0.02, 0.02);
  // Tone-mapped and lit. As an unlit basic material it left the tone mapper
  // entirely, hit the bloom pass at full value, and read as a light strip
  // rather than as paint.
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: theme.roadEdge,
    roughness: 0.55,
    metalness: 0,
  });
  group.add(new THREE.Mesh(lineGeo, lineMaterial));
  pieces.push(
    { dispose: () => lineGeo.dispose() },
    { dispose: () => lineMaterial.dispose() },
  );

  // ── Rumble strip: the shoulder you can still drive on, slowly ─────────────
  const rumbleMap = rumbleTexture(theme.rail, 0xf4f6f8);
  const rumbleGeo = bothSides(track, 0, RUMBLE_WIDTH, 3.2, 0.01, 0.01);
  const rumbleMaterial = new THREE.MeshStandardMaterial({
    map: rumbleMap,
    roughness: 0.82,
  });
  const rumble = new THREE.Mesh(rumbleGeo, rumbleMaterial);
  rumble.receiveShadow = quality.shadows;
  group.add(rumble);
  pieces.push(
    { dispose: () => rumbleGeo.dispose() },
    { dispose: () => rumbleMaterial.dispose() },
    { dispose: () => rumbleMap.dispose() },
  );

  // ── Apron: the land the circuit sits on ───────────────────────────────────
  const apronMap = groundTexture(theme.ground, theme.groundAccent);
  const apronInner = bothSides(
    track,
    RUMBLE_WIDTH,
    APRON_INNER,
    30,
    0,
    -APRON_DROP_INNER,
  );
  const apronOuter = bothSides(
    track,
    APRON_INNER,
    APRON_OUTER,
    30,
    -APRON_DROP_INNER,
    -APRON_DROP_OUTER,
  );
  const apronGeo = mergeGeometries([apronInner, apronOuter])!;
  apronInner.dispose();
  apronOuter.dispose();
  const apronMaterial = new THREE.MeshStandardMaterial({
    map: apronMap,
    roughness: 0.97,
    side: THREE.DoubleSide,
  });
  const apron = new THREE.Mesh(apronGeo, apronMaterial);
  apron.receiveShadow = quality.shadows;
  group.add(apron);
  pieces.push(
    { dispose: () => apronGeo.dispose() },
    { dispose: () => apronMaterial.dispose() },
    { dispose: () => apronMap.dispose() },
  );

  const rails = railPieces(track, theme.rail, quality);
  group.add(rails.object);
  pieces.push(...rails.pieces);

  const props = propPieces(track, quality);
  group.add(props.object);
  pieces.push(...props.pieces);

  // ── Start / finish ────────────────────────────────────────────────────────
  const startSample = track.samples[0]!;
  const checker = checkerTexture(10);
  checker.repeat.set(8, 1);
  const startGeo = new THREE.PlaneGeometry(startSample.half * 2, 5);
  startGeo.rotateX(-Math.PI / 2);
  const startMaterial = new THREE.MeshStandardMaterial({
    map: checker,
    roughness: 0.75,
  });
  const startLine = new THREE.Mesh(startGeo, startMaterial);
  startLine.position.set(startSample.x, startSample.y + 0.04, startSample.z);
  startLine.rotation.y = Math.atan2(startSample.tx, startSample.tz);
  group.add(startLine);
  pieces.push(
    { dispose: () => startGeo.dispose() },
    { dispose: () => startMaterial.dispose() },
    { dispose: () => checker.dispose() },
  );

  // A gantry over the line, so the lap has a landmark.
  const gantryParts: THREE.BufferGeometry[] = [];
  const pillar = new THREE.BoxGeometry(1.2, 9, 1.2);
  for (const side of [1, -1] as const) {
    const part = pillar.clone();
    part.translate(side * (startSample.half + 1.4), 4.5, 0);
    gantryParts.push(part);
  }
  const beam = new THREE.BoxGeometry(startSample.half * 2 + 4, 1.6, 1.4);
  beam.translate(0, 9.6, 0);
  gantryParts.push(beam);
  const gantryGeo = mergeGeometries(gantryParts)!;
  for (const part of gantryParts) part.dispose();
  pillar.dispose();
  const gantryMaterial = new THREE.MeshStandardMaterial({
    color: theme.rail,
    roughness: 0.45,
    metalness: 0.5,
  });
  const gantry = new THREE.Mesh(gantryGeo, gantryMaterial);
  gantry.position.set(startSample.x, startSample.y, startSample.z);
  gantry.rotation.y = Math.atan2(startSample.tx, startSample.tz);
  gantry.castShadow = quality.shadows;
  group.add(gantry);
  pieces.push(
    { dispose: () => gantryGeo.dispose() },
    { dispose: () => gantryMaterial.dispose() },
  );

  // ── Item boxes ────────────────────────────────────────────────────────────
  const boxMap = itemBoxTexture();
  const boxGeo = new THREE.BoxGeometry(1.85, 1.85, 1.85);
  const boxMaterial = new THREE.MeshStandardMaterial({
    map: boxMap,
    transparent: true,
    opacity: 0.68,
    roughness: 0.08,
    metalness: 0.05,
    color: 0xbfe4ff,
    emissive: 0x2a6fa8,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  });
  const itemBoxes = track.itemBoxes.map((box) => {
    const mesh = new THREE.Mesh(boxGeo, boxMaterial);
    mesh.position.set(box.x, box.y + 1.6, box.z);
    group.add(mesh);
    return mesh;
  });
  pieces.push(
    { dispose: () => boxGeo.dispose() },
    { dispose: () => boxMaterial.dispose() },
    { dispose: () => boxMap.dispose() },
  );

  // ── Boost pads ────────────────────────────────────────────────────────────
  const padMap = boostPadTexture(theme.roadEdge);
  const padMaterial = new THREE.MeshBasicMaterial({
    map: padMap,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });
  const padGeometries: THREE.BufferGeometry[] = [];
  for (const pad of track.boostPads) {
    const plane = new THREE.PlaneGeometry(pad.halfWidth * 2, pad.halfLength * 2);
    plane.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(plane, padMaterial);
    mesh.position.set(pad.x, pad.y + 0.05, pad.z);
    mesh.rotation.y = pad.yaw;
    group.add(mesh);
    padGeometries.push(plane);
  }
  pieces.push(
    {
      dispose: () => {
        for (const geometry of padGeometries) geometry.dispose();
      },
    },
    { dispose: () => padMaterial.dispose() },
    { dispose: () => padMap.dispose() },
  );

  return {
    group,
    itemBoxes,
    update(elapsed, boxCooldowns) {
      for (let i = 0; i < itemBoxes.length; i += 1) {
        const mesh = itemBoxes[i]!;
        mesh.visible = (boxCooldowns[i] ?? 0) <= 0;
        if (!mesh.visible) continue;
        mesh.rotation.y = elapsed * 1.3 + i;
        mesh.rotation.x = Math.sin(elapsed * 1.7 + i) * 0.25;
        mesh.position.y =
          track.itemBoxes[i]!.y + 1.6 + Math.sin(elapsed * 2 + i) * 0.18;
      }
      padMaterial.opacity = 0.42 + Math.sin(elapsed * 6) * 0.18;
      padMap.offset.y = (-elapsed * 0.9) % 1;
    },
    edgeAt(index, side) {
      const sample = track.samples[index]!;
      const lateral = side * sample.half;
      return [
        sample.x + sample.rx * lateral,
        surfaceHeight(sample, lateral),
        sample.z + sample.rz * lateral,
      ] as const;
    },
    dispose() {
      for (const piece of pieces) piece.dispose();
      group.clear();
    },
  };
}
