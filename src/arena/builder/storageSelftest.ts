/**
 * Gate: the three bounds that stand between an untrusted spec and the host.
 *
 * All three were real defects found by review, fixed by hand, and — until this
 * file — guarded by nothing. Each is one careless edit from coming back, and
 * none of them shows up as a crash: a dropped storey looks like a validation
 * error the player caused, and an unbounded loop looks like the room hanging.
 *
 *   level survives the round trip   storage.ts dropped PlacedPart.level, so a
 *                                   saved multi-storey machine did not come
 *                                   back flat — every part landed on the riser
 *                                   holding it up, collided, and the build was
 *                                   rejected as overlapping. Unusable, not
 *                                   merely wrong.
 *   MAX_BUILD_LEVEL                 levelRises() builds one array entry per
 *                                   storey and validateBuild calls computeStats
 *                                   FIRST, so the H5 check that would reject a
 *                                   silly storey has not run yet. `level: 1e9`
 *                                   was 8 GB and a dead host.
 *   MAX_DRIVES                      BotSnap.wp carries one float per drive and
 *                                   chassis-fortress geometrically takes 231
 *                                   one-cell wheels, so without the cap a guest
 *                                   chooses the room's bandwidth for everyone.
 *
 * Old saves must keep loading: a v3 spec has no `level` at all, and the encoder
 * still omits it at storey 0, so yesterday's share codes are byte-identical.
 */

/* localStorage does not exist in Node, and saveGarage/loadGarage are half the
 * surface being tested — a shim keeps this gate on the real functions instead
 * of a copy of them. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  }
};

import { buildCatalog } from "../parts/catalog";
import { MAX_BUILD_LEVEL, MAX_DRIVES } from "../sim/balance";
import { levelRises, validateBuild } from "../sim/build";
import { DEFAULT_ROOM_SETTINGS, type BotSpec, type PlacedPart } from "../sim/types";
import { decodeSpec, encodeSpec, loadGarage, saveGarage } from "./storage";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

const levelsOf = (spec: BotSpec): number[] => spec.parts.map((placed) => placed.level ?? 0);

async function main(): Promise<void> {
  const catalog = buildCatalog();
  const multi = catalog.presets.filter((preset) => preset.parts.some((placed) => (placed.level ?? 0) > 0));

  check(
    "[A0] 多段プリセットが存在する（無ければ以下の検査は何も見ていない）",
    multi.length > 0,
    `多段プリセット = [${multi.map((preset) => preset.name).join(", ")}]`
  );

  /* ---------------- A: the storey survives every path ---------------- */
  for (const preset of multi) {
    const before = levelsOf(preset);

    const shared = decodeSpec(encodeSpec(preset));
    check(
      `[A1] ${preset.name}: 共有コードの往復で段が保たれる`,
      shared !== null && JSON.stringify(levelsOf(shared)) === JSON.stringify(before),
      `${JSON.stringify(before)} -> ${shared ? JSON.stringify(levelsOf(shared)) : "decode failed"}`
    );

    saveGarage([preset]);
    const stored = loadGarage()[0];
    check(
      `[A2] ${preset.name}: ガレージの保存/読込で段が保たれる`,
      stored !== undefined && JSON.stringify(levelsOf(stored)) === JSON.stringify(before),
      `${JSON.stringify(before)} -> ${stored ? JSON.stringify(levelsOf(stored)) : "load failed"}`
    );

    // The failure this actually caused: not a flat machine, an invalid one.
    const revalidated = shared ? validateBuild(shared, catalog, DEFAULT_ROOM_SETTINGS) : null;
    check(
      `[A3] ${preset.name}: 往復後もそのまま出撃できる`,
      revalidated !== null && revalidated.ok,
      `errors = ${JSON.stringify(revalidated?.errors ?? ["decode failed"])}`
    );
  }

  /* ---------------- B: yesterday's saves still load ---------------- */
  const legacyBase = multi[0] ?? catalog.presets[0]!;
  const legacy: BotSpec = {
    ...legacyBase,
    parts: legacyBase.parts.map((placed) => {
      const { level, ...rest } = placed as PlacedPart & { level?: number };
      void level;
      return rest as PlacedPart;
    })
  };
  const legacyBack = decodeSpec(encodeSpec(legacy));
  check(
    "[B1] level を持たない v3 期の機体もそのまま読める",
    legacyBack !== null && legacyBack.parts.length === legacy.parts.length,
    `parts ${legacy.parts.length} -> ${legacyBack ? legacyBack.parts.length : "decode failed"}`
  );
  const flat = catalog.presets.find((preset) => preset.parts.every((placed) => (placed.level ?? 0) === 0));
  check(
    "[B2] 単段機の共有コードは v4 以前と同一（level を書き足していない）",
    flat !== undefined && !encodeSpec(flat).includes("level"),
    flat ? `${flat.name} の符号に "level" は含まれない` : "単段プリセットが無い"
  );

  /* ---------------- C: an untrusted spec cannot size the host's work -------- */
  const riser = catalog.parts.find((part) => part.category === "structure");
  check("[C0] 支柱がカタログにある", riser !== undefined, riser ? riser.id : "none");
  if (riser) {
    const absurd: BotSpec = {
      v: 3,
      name: "hostile",
      chassisId: catalog.parts.find((part) => part.category === "chassis")!.id,
      paint: 0,
      parts: [{ partId: riser.id, face: "deck", cell: [0, 0], rot: 0, level: 1_000_000_000 }]
    };
    const started = Date.now();
    const rises = levelRises(absurd, catalog);
    const elapsed = Date.now() - started;
    check(
      "[C1] level が桁外れでも levelRises は有界（ホストは検証前にこれを呼ぶ）",
      rises.length <= MAX_BUILD_LEVEL + 2 && elapsed < 50,
      `level 1e9 -> rises.length ${rises.length}（上限 ${MAX_BUILD_LEVEL + 2}） / ${elapsed} ms`
    );
  }

  const chassis = catalog.parts.find((part) => part.category === "chassis" && part.deck[0] * part.deck[1] > MAX_DRIVES);
  const wheel = catalog.parts.find((part) => part.category === "drive" && part.cells[0] === 1 && part.cells[1] === 1);
  check(
    "[C2] 駆動を敷き詰められるフレームと1セル駆動が揃っている",
    chassis !== undefined && wheel !== undefined,
    `${chassis?.id ?? "none"} / ${wheel?.id ?? "none"}`
  );
  if (chassis && chassis.category === "chassis" && wheel) {
    const swarm: BotSpec = {
      v: 3,
      name: "swarm",
      chassisId: chassis.id,
      paint: 0,
      parts: Array.from({ length: MAX_DRIVES + 4 }, (_, index) => ({
        partId: wheel.id,
        face: "underside" as const,
        cell: [index % chassis.deck[0], Math.floor(index / chassis.deck[0])] as [number, number],
        rot: 0 as const
      }))
    };
    const verdict = validateBuild(swarm, catalog, { ...DEFAULT_ROOM_SETTINGS, pointBudget: 999_999 });
    const named = verdict.errors.some((error) => error.includes(String(MAX_DRIVES)));
    check(
      "[C3] 駆動の積みすぎは日本語で弾かれ、上限が文中に出る",
      !verdict.ok && named,
      `${MAX_DRIVES + 4} 基 -> ok=${verdict.ok} / ${JSON.stringify(verdict.errors.filter((e) => e.includes("駆動")))}`
    );
  }

  console.log(
    `BOUNDS: MAX_BUILD_LEVEL=${MAX_BUILD_LEVEL} MAX_DRIVES=${MAX_DRIVES}`
  );
  if (failures.length > 0) {
    console.log(`STORAGE SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("STORAGE SELFTEST PASS");
}

main().catch((error) => {
  console.log("STORAGE SELFTEST FAIL:", error);
  process.exitCode = 1;
});
