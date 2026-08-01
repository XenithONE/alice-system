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
import {
  createKartVisual,
  disposeSharedKartGeometry,
  type KartTextureFactory,
} from "./kartModel";
import { MACHINES } from "../content/machines";
import { MAX_RACERS } from "../sim/types";

const gate = createGate();

/** Blank textures: the graph shape is identical, no canvas required. */
const stubTexture = (): THREE.Texture => new THREE.Texture();
const STUB_TRACK_TEXTURES: TrackTextureFactory = {
  asphalt: stubTexture,
  loose: stubTexture,
  rumble: stubTexture,
  checker: stubTexture,
  ground: stubTexture,
  itemBox: stubTexture,
  boostPad: stubTexture,
};
const STUB_KART_TEXTURES: KartTextureFactory = {
  roundel: stubTexture,
  headlightPool: stubTexture,
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

// [BG5] the shadow passes cost too, and countDrawCalls cannot see them ──────
{
  /*
   * `renderer.info.render.calls` — and therefore `countDrawCalls` — counts the
   * colour pass. A shadow-casting mesh is drawn again per shadow map, so with
   * three cascades a scene of 60 casters costs 180 extra draws that no gate has
   * ever looked at. This is the gate for the cost CSM just introduced, added
   * in the same change that introduced it.
   */
  /*
   * 260, set from the measurement rather than guessed at: the worst circuit
   * costs 195 shadow draws (65 casters × 3), so this leaves room for roughly
   * twenty more casters on a future course and fails on anything approaching a
   * doubling. A budget with 2.5× headroom is not a budget — it is a number
   * that will still be passing on the day the frame rate collapses.
   */
  const BUDGET = 260;
  const rows: { scene: string; casters: number; cascades: number; total: number }[] =
    [];
  let worst = 0;
  let worstLabel = "";
  for (const label of ["HIGH", "BALANCED", "LOW"] as const) {
    const quality = qualityFor(label);
    for (const spec of TRACKS) {
      const track = buildTrack(spec);
      const mesh = buildTrackMesh(
        track,
        { shadows: quality.shadows, propDensity: quality.propDensity },
        STUB_TRACK_TEXTURES,
      );
      const group = new THREE.Group();
      group.add(mesh.group);
      const pieces = buildSetPieces(track, stubContext(quality));
      if (pieces) group.add(pieces.group);
      const stands = createGrandstands(
        track,
        quality.grandstands,
        quality.shadows,
        new THREE.Texture(),
      );
      group.add(stands.group);

      // Measured, not assumed: only some of a kart's meshes cast (the roundel
      // and the headlight pool do not), so the grid's contribution has to come
      // from the same builder the game uses.
      const grid = MACHINES.slice(0, MAX_RACERS).map((machine, seat) =>
        createKartVisual({
          livery: seat,
          castShadow: quality.shadows,
          shape: machine.shape,
          textures: STUB_KART_TEXTURES,
        }),
      );
      for (const kart of grid) group.add(kart.root);

      let casters = 0;
      group.traverse((object) => {
        // One shadow draw per mesh per cascade; an InstancedMesh is still one.
        if (object.visible && object.castShadow && (object as THREE.Mesh).isMesh) {
          casters += 1;
        }
      });
      for (const kart of grid) kart.dispose();
      disposeSharedKartGeometry();
      const total = casters * Math.max(1, quality.shadowCascades);
      rows.push({
        scene: `${label}/${spec.id}`,
        casters,
        cascades: quality.shadowCascades,
        total,
      });
      if (total > worst) {
        worst = total;
        worstLabel = `${label}/${spec.id}`;
      }
      stands.dispose();
      pieces?.dispose();
      mesh.dispose();
    }
  }
  gate.check(
    "[BG5] 影パスの総ドロー（キャスター × カスケード）が予算内",
    worst <= BUDGET,
    `最悪 ${worst} / 上限 ${BUDGET}（${worstLabel}）`,
  );
  gate.expectFail(
    "[BG5-neg] カスケードを6段にすると予算を超える",
    () => {
      const doubled = Math.round((worst / 3) * 6);
      return doubled <= BUDGET;
    },
    "3段の最悪値を6段に換算",
  );
  console.table(rows);
}

// [BG6] the grid itself costs draw calls, and nothing has ever counted them ──
{
  /*
   * The budgets above measure the track and the set pieces. The eight karts
   * standing on that track were simply absent from the accounting — a blind
   * spot that widened the moment machines got their own silhouettes, because
   * from here on a shape can gain parts without any gate noticing.
   *
   * 128 is the ceiling because BUDGETS.LOW is 90: a low-tier scene plus a full
   * grid has to stay inside what a phone will actually draw.
   */
  const grid = new THREE.Group();
  const built = MACHINES.slice(0, MAX_RACERS).map((machine, seat) =>
    createKartVisual({
      livery: seat,
      castShadow: true,
      raceNumber: seat + 1,
      headlights: true,
      shape: machine.shape,
      textures: STUB_KART_TEXTURES,
    }),
  );
  // Six machines, eight seats: the last two repeat, exactly as a full room does.
  while (built.length < MAX_RACERS) {
    const machine = MACHINES[built.length % MACHINES.length]!;
    built.push(
      createKartVisual({
        livery: built.length,
        castShadow: true,
        raceNumber: built.length + 1,
        headlights: true,
        shape: machine.shape,
        textures: STUB_KART_TEXTURES,
      }),
    );
  }
  for (const entry of built) grid.add(entry.root);
  const calls = countDrawCalls(grid);
  gate.check(
    "[BG6] 8台満載のグリッドが 128 ドローコール以内",
    calls <= 128,
    `${calls} calls（1台あたり ${(calls / MAX_RACERS).toFixed(1)}・LOW予算 ${BUDGETS.LOW} との合計 ${calls + BUDGETS.LOW}）`,
  );
  gate.expectFail(
    "[BG6-neg] 1台あたり8メッシュ増やすと予算を超える",
    () => {
      const bloat = new THREE.Group();
      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const material = new THREE.MeshBasicMaterial();
      for (let i = 0; i < MAX_RACERS * 8; i += 1) {
        bloat.add(new THREE.Mesh(geometry, material));
      }
      return calls + countDrawCalls(bloat) <= 128;
    },
    "1台あたり8メッシュの水増し",
  );
  for (const entry of built) entry.dispose();
  disposeSharedKartGeometry();
}

console.table(
  Object.entries(counts).map(([key, calls]) => ({ scene: key, calls })),
);

gate.finish("BUDGET SELFTEST");
