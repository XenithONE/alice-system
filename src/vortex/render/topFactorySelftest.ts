import * as THREE from "three";
import { makeArcade, type BattleArenaVisual } from "./battleScene";
import {
  PARTS,
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  createDefaultBuild,
  getPart,
  type TopPartDef,
} from "../content";
import {
  createTopVisual,
  disposeTopVisual,
  type TopVisualPart,
  type TopVisualSpec,
} from "./topFactory";
import {
  MAX_STACK_DECORATIONS,
  applyCrowdBattleLod,
  createBattleStackDecoration,
  resolveBattlePresentation,
} from "./battlePresentation";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message = "values differ"): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

function assertNotEqual<T>(actual: T, expected: T, message = "values match"): void {
  if (Object.is(actual, expected)) throw new Error(message);
}

function toVisualPart(part: TopPartDef): TopVisualPart {
  return {
    id: part.id,
    slot: TOP_SLOTS.indexOf(part.slot),
    lineage: TOP_LINEAGES.indexOf(part.lineage),
    role: TOP_ROLES.indexOf(part.role),
    grade: part.grade === "signature" ? 2 : part.grade - 1,
    color: part.visual.primaryColor,
  };
}

function spec(parts: readonly TopPartDef[]): TopVisualSpec {
  return { paint: 0x48d9ff, parts: parts.map(toVisualPart) };
}

function metrics(
  visualSpec: TopVisualSpec,
  quality: "high" | "battle" | "low",
): { meshes: number; shadowCasters: number; triangles: number } {
  const root = createTopVisual(visualSpec, { quality });
  let meshes = 0;
  let shadowCasters = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    if (object.castShadow) shadowCasters += 1;
    const primitiveTriangles =
      (object.geometry.index?.count ??
        object.geometry.getAttribute("position")?.count ??
        0) / 3;
    triangles +=
      primitiveTriangles *
      (object instanceof THREE.InstancedMesh ? object.count : 1);
  });
  disposeTopVisual(root);
  return { meshes, shadowCasters, triangles };
}

function shapeFingerprint(part: TopPartDef): string {
  const root = createTopVisual(spec([part]), { quality: "battle" });
  const records: (string | number)[][] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox!;
    records.push([
      object.geometry.type,
      object.geometry.getAttribute("position")?.count ?? 0,
      object.geometry.index?.count ?? 0,
      object instanceof THREE.InstancedMesh ? object.count : 1,
      ...bounds.min.toArray().map((value: number) => Number(value.toFixed(5))),
      ...bounds.max.toArray().map((value: number) => Number(value.toFixed(5))),
    ]);
  });
  disposeTopVisual(root);
  return JSON.stringify(records);
}

const defaultBuild = createDefaultBuild();
const regularSpec = spec(
  TOP_SLOTS.map((slot) => {
    const part = getPart(defaultBuild.parts[slot]);
    assert(part);
    return part;
  }),
);
const maximumSignatureSpec = spec(
  TOP_SLOTS.map((slot) => {
    const part = PARTS.find(
      (candidate) =>
        candidate.slot === slot &&
        candidate.grade === "signature" &&
        candidate.id.endsWith("-obsidian"),
    );
    assert(part);
    return part;
  }),
);

const regularHigh = metrics(regularSpec, "high");
const signatureHigh = metrics(maximumSignatureSpec, "high");
const regularBattle = metrics(regularSpec, "battle");
const signatureBattle = metrics(maximumSignatureSpec, "battle");
const signatureLow = metrics(maximumSignatureSpec, "low");

for (const result of [regularBattle, signatureBattle, signatureLow]) {
  assert(result.meshes < 30, `battle top emitted ${result.meshes} mesh draws`);
  assert(result.triangles < 25_000, `battle top emitted ${result.triangles} triangles`);
  assertEqual(result.shadowCasters, 0, "battle LOD must not add shadow-map draws");
}

const GATE_ARENA: BattleArenaVisual = {
  id: "gate",
  radius: 7.38,
  lipHeight: 0.35,
  profile: [[0, -0.62], [0.5, -0.3], [1, 0.54]],
};

/*
 * The arcade and the FX pools are counted, not assumed.
 *
 * This line used to read `+ 8 + 4 + 4 + 1` with a comment naming what those
 * numbers were. That is an accounting model, and a model does not notice when
 * someone adds three meshes to the arena — it keeps reporting the old total
 * while the real scene grows. Building the arcade here and counting its
 * children means the arena part of the budget is measured.
 */
const arcadeFull = makeArcade(GATE_ARENA, false);
const arcadeLite = makeArcade(GATE_ARENA, true);
const arcadeCalls = arcadeFull.children.length;
assert(
  arcadeCalls <= 3,
  `arcade costs ${arcadeCalls} draw calls; the budget is three`,
);
assert(
  arcadeLite.children.length < arcadeCalls,
  "lite detail must drop arcade draws, not keep them",
);

// Two pooled FX draws: one ring pool, one shell pool. See battleScene.
const fxPoolCalls = 2;
// Main pass: four tops, arena surfaces, the arcade, labels/trails, FX pools.
const maximumBattleCalls =
  signatureBattle.meshes * 4 + 8 + arcadeCalls + 4 + 4 + 1 + fxPoolCalls;
assert(
  maximumBattleCalls <= 150,
  `four-player battle requires ${maximumBattleCalls} structural draw calls`,
);

// Editor main pass plus stage/guides and one shadow pass for top casters.
const maximumBuilderCalls =
  Math.max(regularHigh.meshes, signatureHigh.meshes) +
  12 +
  Math.max(regularHigh.shadowCasters, signatureHigh.shadowCasters);
assert(
  maximumBuilderCalls <= 60,
  `builder requires ${maximumBuilderCalls} structural draw calls`,
);
assert(signatureHigh.triangles < 100_000);

const classicPresentation = resolveBattlePresentation(4);
assertEqual(classicPresentation.length, 4);
assertEqual(classicPresentation[0]?.color, 0x62ddff, "classic P1 palette changed");
assertEqual(classicPresentation[1]?.color, 0xffb448, "classic P2 palette changed");
assert(classicPresentation.every((seat) => seat.team === "ally"));
assert(classicPresentation.every((seat) => seat.extraStacks === 0));

const maximumStacks = Array.from({ length: 6 }, () =>
  Array.from({ length: 7 }, (_, slot) => 3 + (slot % 3)),
);
const endlessPresentation = resolveBattlePresentation(6, {
  playerCount: 4,
  wave: 37,
  stackCounts: maximumStacks,
});
assertEqual(endlessPresentation.filter((seat) => seat.team === "ally").length, 4);
assertEqual(endlessPresentation.filter((seat) => seat.team === "enemy").length, 2);
for (const enemy of endlessPresentation.slice(4)) {
  const color = new THREE.Color(enemy.color);
  assert(
    color.r > color.g * 1.35 && color.r > color.b * 1.25,
    "enemy team marker is not red-dominant",
  );
}

let endlessTopCalls = 0;
let maximumVisibleCrowdTopCalls = 0;
let maximumDecorationCalls = 0;
let maximumDecorationInstances = 0;
for (const seat of endlessPresentation) {
  const root = createTopVisual(maximumSignatureSpec, {
    quality: "low",
    playerColor: seat.color,
  });
  const compactCalls = applyCrowdBattleLod(root);
  maximumVisibleCrowdTopCalls = Math.max(maximumVisibleCrowdTopCalls, compactCalls);
  const decorations = createBattleStackDecoration(seat);
  root.add(decorations);
  let decorationCalls = 0;
  let decorationInstances = 0;
  let decorationResources = 0;
  let disposedDecorationResources = 0;
  decorations.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    decorationCalls += 1;
    decorationInstances += object.count;
    decorationResources += 2;
    object.geometry.addEventListener("dispose", () => {
      disposedDecorationResources += 1;
    });
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    assertEqual(materials.length, 1, "stack draw unexpectedly split its material");
    materials[0]!.addEventListener("dispose", () => {
      disposedDecorationResources += 1;
    });
  });
  maximumDecorationCalls = Math.max(maximumDecorationCalls, decorationCalls);
  maximumDecorationInstances = Math.max(maximumDecorationInstances, decorationInstances);
  assert(decorationCalls <= 2, "stack presentation exceeded two instanced draws");
  assert(
    decorationInstances <= MAX_STACK_DECORATIONS,
    "stack presentation exceeded its twelve-piece cap",
  );
  endlessTopCalls += compactCalls + decorationCalls;
  disposeTopVisual(root);
  assertEqual(
    disposedDecorationResources,
    decorationResources,
    "stack presentation leaked a GPU geometry or material",
  );
}

// Six compact tops, arena surfaces, name labels, trails and the shared spark
// pool. Instancing keeps twelve visible stack pieces per top to two calls.
const maximumEndlessBattleCalls = endlessTopCalls + 8 + 6 + 6 + 1;
assert(
  maximumEndlessBattleCalls <= 180,
  `six-player endless battle requires ${maximumEndlessBattleCalls} structural draw calls`,
);

for (const slot of TOP_SLOTS) {
  const signatures = PARTS.filter(
    (part) => part.slot === slot && part.grade === "signature",
  );
  assertEqual(signatures.length, 3);
  const fingerprints = signatures.map(shapeFingerprint);
  assertEqual(
    new Set(fingerprints).size,
    3,
    `${slot} signature variants are not geometrically distinct`,
  );
  signatures.forEach((signature, index) => {
    const ordinary = PARTS.find(
      (candidate) =>
        candidate.slot === slot &&
        candidate.lineage === signature.lineage &&
        candidate.role === signature.role &&
        candidate.grade === 3,
    );
    assert(ordinary);
    assertNotEqual(
      fingerprints[index],
      shapeFingerprint(ordinary),
      `${signature.id} duplicates ${ordinary.id}`,
    );
  });
}

console.log(
  JSON.stringify({
    regularHigh,
    signatureHigh,
    regularBattle,
    signatureBattle,
    signatureLow,
    maximumBattleCalls,
    maximumEndlessBattleCalls,
    maximumVisibleCrowdTopCalls,
    maximumDecorationCalls,
    maximumDecorationInstances,
    maximumBuilderCalls,
    signatureShapes: 21,
  }),
);
