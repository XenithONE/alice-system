import * as THREE from "three";
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

// Main pass: four tops, eight arena surfaces, labels/trails, one pooled FX draw.
const maximumBattleCalls = signatureBattle.meshes * 4 + 8 + 4 + 4 + 1;
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
    maximumBuilderCalls,
    signatureShapes: 21,
  }),
);
