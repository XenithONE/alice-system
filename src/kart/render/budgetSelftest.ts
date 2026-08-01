/**
 * Gate: the scene fits its draw-call budget, headless.
 *
 * `renderer.info` can only be read in a browser, and the one time it was
 * trusted blindly it reported 1 draw call for a hundred-object scene
 * (EffectComposer resets it per pass). This gate counts the scene graph
 * itself: every visible Mesh / InstancedMesh / Points / Line is one call.
 * It builds the real track meshes and the real set pieces through the
 * texture seams, so a set piece that explodes the budget fails CI before
 * anyone sees a frame.
 *
 * It also asserts no set-piece geometry intrudes into the driving corridor —
 * scenery that leans over the road below head height reads as a collision
 * bug even though the sim never collides with it.
 *
 * Run: npx tsx src/kart/render/budgetSelftest.ts
 */
import * as THREE from "three";
import { createGate } from "../gate";
import { SHOULDER_WIDTH } from "../sim/balance";
import { buildTrack, querySurface } from "../sim/track";
import { TRACKS } from "../sim/tracks";
import { resolveQuality, type KartQuality, type QualityLabel } from "./quality";
import { buildTrackMesh, type TrackTextureFactory } from "./trackMesh";
import {
  buildSetPieces,
  SET_PIECES,
  type SetPieceContext,
} from "./setpieces";
import { createClouds } from "./clouds";
import { createGrandstands } from "./grandstand";

const gate = createGate();

/** Blank textures: the graph shape is identical, no canvas required. */
const stubTexture = (): THREE.Texture => new THREE.Texture();
const STUB_TRACK_TEXTURES: TrackTextureFactory = {
  asphalt: stubTexture,
  rumble: stubTexture,
  checker: stubTexture,
  ground: stubTexture,
  itemBox: stubTexture,
  boostPad: stubTexture,
};

function stubContext(quality: KartQuality): SetPieceContext {
  return {
    detail: quality.setPieceDetail,
    shadows: quality.shadows,
    texture: () => new THREE.Texture(),
  };
}

function qualityFor(label: QualityLabel): KartQuality {
  const probes = {
    HIGH: {
      deviceMemory: 16,
      hardwareConcurrency: 12,
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
      coarsePointer: false,
      webgl2: true,
    },
    BALANCED: {
      deviceMemory: 4,
      hardwareConcurrency: 4,
      innerWidth: 1280,
      innerHeight: 800,
      devicePixelRatio: 1,
      coarsePointer: false,
      webgl2: true,
    },
    LOW: {
      deviceMemory: 2,
      hardwareConcurrency: 2,
      innerWidth: 390,
      innerHeight: 844,
      devicePixelRatio: 2,
      coarsePointer: true,
      webgl2: false,
    },
  } as const;
  return resolveQuality("auto", probes[label]);
}

function countDrawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverse((object) => {
    if (!object.visible) return;
    if (
      (object as THREE.Mesh).isMesh ||
      (object as THREE.Points).isPoints ||
      (object as THREE.Line).isLine
    ) {
      calls += 1;
    }
  });
  return calls;
}

/** Vertices of a set piece that sit inside the driving corridor's airspace. */
function corridorIntrusions(track: ReturnType<typeof buildTrack>, root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  let intrusions = 0;
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    // Pickups, pads and (later) ramps belong on the road.
    if (mesh.name.startsWith("gameplay:")) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    if (mesh instanceof THREE.InstancedMesh) {
      // Every instance, few vertices: a single stray palm IS the bug class.
      const matrix = new THREE.Matrix4();
      const sparse = Math.max(1, Math.floor(position.count / 12));
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        for (let i = 0; i < position.count; i += sparse) {
          vertex.fromBufferAttribute(position, i);
          const world = vertex
            .clone()
            .applyMatrix4(matrix)
            .applyMatrix4(mesh.matrixWorld);
          if (inCorridor(track, world)) intrusions += 1;
        }
      }
    } else {
      const step = Math.max(1, Math.floor(position.count / 220));
      for (let i = 0; i < position.count; i += step) {
        vertex.fromBufferAttribute(position, i);
        const world = vertex.clone().applyMatrix4(mesh.matrixWorld);
        if (inCorridor(track, world)) intrusions += 1;
      }
    }
  });
  return intrusions;
}

function inCorridor(track: ReturnType<typeof buildTrack>, point: THREE.Vector3): boolean {
  const query = querySurface(track, point.x, point.z, -1, SHOULDER_WIDTH);
  if (!query.onRoad) return false;
  // The airspace a kart (and its camera) occupies. Above 4.2 m is legal —
  // arches and banners deliberately cross there.
  return point.y > query.height + 0.4 && point.y < query.height + 4.2;
}

const BUDGETS: Record<QualityLabel, number> = {
  HIGH: 210,
  BALANCED: 160,
  LOW: 90,
};

// [BG1] totality: every circuit has a set-piece builder ─────────────────────
{
  const missing = TRACKS.filter((spec) => !SET_PIECES[spec.id]);
  gate.check(
    "[BG1] 全コースにセットピース builder が登録されている",
    missing.length === 0,
    missing.length ? `未登録: ${missing.map((spec) => spec.id).join(", ")}` : `${TRACKS.length} コース`,
  );
}

// [BG2] static draw-call budget per track per tier ──────────────────────────
const counts: Record<string, number> = {};
for (const spec of TRACKS) {
  const track = buildTrack(spec);
  for (const label of ["HIGH", "BALANCED", "LOW"] as const) {
    const quality = qualityFor(label);
    const mesh = buildTrackMesh(
      track,
      { shadows: quality.shadows, propDensity: quality.propDensity },
      STUB_TRACK_TEXTURES,
    );
    const pieces = buildSetPieces(track, stubContext(quality));
    const clouds =
      quality.cloudCount > 0
        ? createClouds(track, quality.cloudCount, 0xffffff, new THREE.Texture())
        : null;
    const stands = createGrandstands(
      track,
      quality.grandstands,
      quality.shadows,
      new THREE.Texture(),
    );
    const calls =
      countDrawCalls(mesh.group) +
      countDrawCalls(pieces.group) +
      (clouds ? countDrawCalls(clouds.object) : 0) +
      countDrawCalls(stands.group);
    counts[`${spec.id}:${label}`] = calls;
    gate.check(
      `[BG2:${spec.id}:${label}] 静的 draw call が予算内`,
      calls <= BUDGETS[label],
      `${calls} / ${BUDGETS[label]}`,
    );
    // [BG3] nothing leans into the driving corridor — set pieces AND the
    // track's own prop scatter (the one real offender so far was a palm).
    const intrusions =
      corridorIntrusions(track, pieces.group) +
      corridorIntrusions(track, mesh.group);
    gate.check(
      `[BG3:${spec.id}:${label}] 装飾が走行空間に食い込まない`,
      intrusions === 0,
      `侵入頂点 ${intrusions}`,
    );
    pieces.dispose();
    clouds?.dispose();
    stands.dispose();
    mesh.dispose();
  }
}

// [BG2-neg] the counter counts: 300 extra meshes must blow the budget ───────
gate.expectFail(
  "[BG2-neg] メッシュを300個足すと予算検査が落ちる",
  () => {
    const track = buildTrack(TRACKS[0]!);
    const quality = qualityFor("HIGH");
    const mesh = buildTrackMesh(
      track,
      { shadows: quality.shadows, propDensity: quality.propDensity },
      STUB_TRACK_TEXTURES,
    );
    const flood = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    for (let i = 0; i < 300; i += 1) {
      flood.add(new THREE.Mesh(geometry, material));
    }
    const calls = countDrawCalls(mesh.group) + countDrawCalls(flood);
    mesh.dispose();
    return calls <= BUDGETS.HIGH;
  },
  "300 メッシュの洪水",
);

// [BG3-neg] the intrusion probe probes: a crate on the start line must fail ─
gate.expectFail(
  "[BG3-neg] スタートライン上の箱は侵入検査に落ちる",
  () => {
    const track = buildTrack(TRACKS[0]!);
    const start = track.samples[0]!;
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );
    crate.position.set(start.x, start.y + 1.2, start.z);
    const group = new THREE.Group();
    group.add(crate);
    return corridorIntrusions(track, group) === 0;
  },
  "路面中央 y+1.2 の 2m 箱",
);

console.table(
  Object.entries(counts).map(([key, calls]) => ({ scene: key, calls })),
);

gate.finish("BUDGET SELFTEST");
