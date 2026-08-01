/**
 * Gate: the catalog is consistent with itself, with the physics, and with what
 * the player is told.
 *
 * The one that matters most is [C6]. Stars are the only thing a player can see
 * before committing to a machine, and nothing else in the codebase connects
 * them to the coefficients that actually drive the car — a typo there is a
 * catalog that lies, silently, forever. So the order of the stars is checked
 * against the order of the numbers, and swapping two entries has to break it.
 *
 * Run: npx tsx src/kart/content/gates.ts
 */
import { createGate } from "../gate";
import { SPEED_CLASSES } from "../sim/balance";
import { ITEM_KINDS } from "../sim/types";
import { ITEM_CODES, ITEM_SLOT_MAX, ITEM_SLOT_RADIX } from "../net/protocol";
import { abilityById, CHARACTER_SKILLS, MACHINE_GIMMICKS } from "./abilities";
import { CHARACTERS, REFERENCE_CHARACTER_ID, characterById } from "./characters";
import { MACHINES, REFERENCE_MACHINE_ID, machineById } from "./machines";
import {
  classTuningFor,
  combineTuning,
  type DisplayStatKey,
  type KartTuning,
} from "./tuning";

const gate = createGate();

// [C1] shape ────────────────────────────────────────────────────────────────
{
  const characterIds = new Set(CHARACTERS.map((entry) => entry.id));
  const machineIds = new Set(MACHINES.map((entry) => entry.id));
  gate.check(
    "[C1] キャラ8体・マシン6台・id が一意",
    CHARACTERS.length === 8 &&
      MACHINES.length === 6 &&
      characterIds.size === CHARACTERS.length &&
      machineIds.size === MACHINES.length,
    `キャラ ${CHARACTERS.length}/${characterIds.size} マシン ${MACHINES.length}/${machineIds.size}`,
  );
  gate.expectFail(
    "[C1-neg] id が重複したカタログは一意性検査を通らない",
    () => {
      const ids = [...CHARACTERS.map((e) => e.id), CHARACTERS[0]!.id];
      return new Set(ids).size === ids.length;
    },
    "先頭 id を複製",
  );
}

// [C2] every ability id resolves ────────────────────────────────────────────
{
  const missing = [
    ...CHARACTERS.map((entry) => entry.skillId),
    ...MACHINES.map((entry) => entry.gimmickId),
  ].filter((id) => abilityById(id) === null);
  gate.check(
    "[C2] 全ての skillId / gimmickId がアビリティに解決する",
    missing.length === 0,
    missing.length === 0 ? "全件解決" : `未解決: ${missing.join(", ")}`,
  );
  gate.expectFail(
    "[C2-neg] 存在しない id は解決しない",
    () => abilityById("no-such-ability") !== null,
    "架空の id",
  );
}

// [C3] the reference kit is exactly the identity ────────────────────────────
/*
 * Strict equality, not a tolerance. `x * 1 === x` holds for every finite x in
 * IEEE 754, and that identity is what lets the whole tuning path be inserted
 * under the existing headless gates without moving a single lap time. A
 * coefficient of 1.0000001 would look harmless and would move all of them.
 */
{
  const reference = combineTuning(
    { speedScale: 1, turnScale: 1 },
    characterById(REFERENCE_CHARACTER_ID),
    machineById(REFERENCE_MACHINE_ID),
  );
  const offenders = (Object.keys(reference) as (keyof KartTuning)[]).filter(
    (key) => reference[key] !== 1,
  );
  gate.check(
    "[C3] 基準キットの全係数が厳密に 1",
    offenders.length === 0,
    offenders.length === 0 ? "9項目すべて 1" : `1 でない: ${offenders.join(", ")}`,
  );
  gate.expectFail(
    "[C3-neg] ごく僅かにずれた係数も検出される",
    () => {
      const tweaked = combineTuning({ speedScale: 1.0000001, turnScale: 1 }, null, null);
      return (Object.keys(tweaked) as (keyof KartTuning)[]).every(
        (key) => tweaked[key] === 1,
      );
    },
    "speedScale = 1.0000001",
  );
}

// [C4] gripScale is always the product, bit for bit ─────────────────────────
{
  let mismatches = 0;
  let combos = 0;
  for (let speedClass = 0; speedClass < SPEED_CLASSES.length; speedClass += 1) {
    for (const character of CHARACTERS) {
      for (const machine of MACHINES) {
        const tuning = combineTuning(
          classTuningFor(speedClass),
          character,
          machine,
        );
        combos += 1;
        if (tuning.gripScale !== tuning.speedScale * tuning.turnScale) {
          mismatches += 1;
        }
      }
    }
  }
  gate.check(
    "[C4] 全組合せで gripScale === speedScale * turnScale（ビット厳密）",
    mismatches === 0,
    `${combos} 通り・不一致 ${mismatches}`,
  );
  gate.expectFail(
    "[C4-neg] 手で入れた gripScale は積と一致しない",
    () => {
      const tuning = combineTuning(classTuningFor(2), null, null);
      const forged = { ...tuning, gripScale: 1.3 };
      return forged.gripScale === forged.speedScale * forged.turnScale;
    },
    "gripScale を 1.3 に差し替え",
  );
}

// [C5] no machine is simply better than another ─────────────────────────────
/*
 * The bands are not uniform, because the coefficients are not comparable.
 * `speedScale` and `turnScale` set lap time on a clean lap and compound over
 * three of them, so ±10% is already the difference between classes. The other
 * two only pay out in states the driver would rather not be in — off the road,
 * or in contact — so a machine can be much better at those without being
 * better at racing, which is exactly the identity a buggy is supposed to have.
 */
{
  const BANDS = {
    speedScale: [0.9, 1.1],
    turnScale: [0.9, 1.1],
    accelScale: [0.85, 1.2],
    offroadScale: [0.8, 1.5],
    bumpScale: [0.7, 1.4],
  } as const;
  const KEYS = Object.keys(BANDS) as (keyof typeof BANDS)[];
  const valueOf = (machine: (typeof MACHINES)[number], key: (typeof KEYS)[number]): number =>
    machine.physics[key] ?? 1;
  let dominating: string[] = [];
  let outOfBand: string[] = [];
  for (const machine of MACHINES) {
    for (const key of KEYS) {
      const value = valueOf(machine, key);
      const [low, high] = BANDS[key];
      if (value < low || value > high) {
        outOfBand.push(`${machine.id}.${key}=${value}`);
      }
    }
  }
  for (const a of MACHINES) {
    for (const b of MACHINES) {
      if (a.id === b.id) continue;
      const better = KEYS.every((key) => valueOf(a, key) >= valueOf(b, key));
      const strictly = KEYS.some((key) => valueOf(a, key) > valueOf(b, key));
      if (better && strictly) dominating.push(`${a.id} > ${b.id}`);
    }
  }
  gate.check(
    "[C5] どのマシンも全項目で他を上回らない・係数が項目ごとの帯域内",
    dominating.length === 0 && outOfBand.length === 0,
    dominating.length + outOfBand.length === 0
      ? "支配関係なし・帯域内"
      : `支配 ${dominating.join(" / ")} 帯域外 ${outOfBand.join(" / ")}`,
  );
  gate.expectFail(
    "[C5-neg] 全項目で上回るマシンは支配検査に引っかかる",
    () => {
      const bully: Record<string, number> = {};
      for (const key of KEYS) bully[key] = 1.6;
      const better = KEYS.every((key) => bully[key]! >= valueOf(MACHINES[0]!, key));
      const strictly = KEYS.some((key) => bully[key]! > valueOf(MACHINES[0]!, key));
      return !(better && strictly);
    },
    "全項目 1.6 のマシン",
  );
}

// [C6] the stars agree with the physics ─────────────────────────────────────
/*
 * The player picks from stars; the sim runs on coefficients. If the two orders
 * disagree the garage is misinformation, and there is no other check anywhere
 * that would notice.
 */
{
  const PAIRS: readonly {
    stat: DisplayStatKey;
    physics: "speedScale" | "turnScale" | "accelScale" | "bumpScale";
  }[] = [
    { stat: "speed", physics: "speedScale" },
    { stat: "handling", physics: "turnScale" },
    { stat: "accel", physics: "accelScale" },
    { stat: "weight", physics: "bumpScale" },
  ];
  const disagreements: string[] = [];
  for (const { stat, physics } of PAIRS) {
    for (const a of MACHINES) {
      for (const b of MACHINES) {
        if (a.id >= b.id) continue;
        const starOrder = Math.sign(a.display[stat] - b.display[stat]);
        const physicsOrder = Math.sign(
          (a.physics[physics] ?? 1) - (b.physics[physics] ?? 1),
        );
        // Equal stars may hide a tiny coefficient gap; opposite signs may not.
        if (starOrder !== 0 && physicsOrder !== 0 && starOrder !== physicsOrder) {
          disagreements.push(`${stat}: ${a.id} vs ${b.id}`);
        }
      }
    }
  }
  gate.check(
    "[C6] ★表示と物理係数の順序が矛盾しない",
    disagreements.length === 0,
    disagreements.length === 0
      ? `${PAIRS.length} 項目 × ${MACHINES.length} 台を照合`
      : disagreements.join(" / "),
  );
  gate.expectFail(
    "[C6-neg] ★を入れ替えると矛盾が出る",
    () => {
      const a = MACHINES.find((m) => m.id === "lancet")!;
      const b = MACHINES.find((m) => m.id === "wisp")!;
      const swapped = Math.sign(b.display.speed - a.display.speed);
      const physicsOrder = Math.sign(
        (a.physics.speedScale ?? 1) - (b.physics.speedScale ?? 1),
      );
      return swapped === physicsOrder || swapped === 0 || physicsOrder === 0;
    },
    "lancet と wisp の ★speed を入れ替え",
  );
}

// [C7] unlocks point at real achievements, and never share ───────────────────
{
  const unlockIds = [...CHARACTERS, ...MACHINES]
    .map((entry) => entry.unlock)
    .filter((rule): rule is { kind: "achievement"; id: string } => rule.kind === "achievement")
    .map((rule) => rule.id);
  const duplicates = unlockIds.filter(
    (id, index) => unlockIds.indexOf(id) !== index,
  );
  gate.check(
    "[C7] 解放実績 id が重複していない",
    duplicates.length === 0,
    duplicates.length === 0 ? `${unlockIds.length} 件` : `重複: ${duplicates.join(", ")}`,
  );
}

// [C8] abilities stay inside the closed vocabulary ──────────────────────────
{
  const bad: string[] = [];
  for (const ability of [...CHARACTER_SKILLS, ...MACHINE_GIMMICKS]) {
    if (!(ability.cooldownSec > 0)) bad.push(`${ability.id}: cooldown`);
    if (ability.effects.length === 0) bad.push(`${ability.id}: 効果なし`);
    for (const effect of ability.effects) {
      if ("seconds" in effect && !(effect.seconds > 0)) {
        bad.push(`${ability.id}: seconds`);
      }
      if (effect.kind === "tuning-mul" && !(effect.multiplier > 0)) {
        bad.push(`${ability.id}: multiplier`);
      }
      if (typeof (effect as { fn?: unknown }).fn === "function") {
        bad.push(`${ability.id}: 実行可能なコールバック`);
      }
    }
  }
  gate.check(
    "[C8] アビリティは宣言的（コールバック無し・秒数と倍率が正）",
    bad.length === 0,
    bad.length === 0
      ? `${CHARACTER_SKILLS.length + MACHINE_GIMMICKS.length} 件`
      : bad.join(" / "),
  );
}

// [C9] the item vocabulary matches the wire, exactly ────────────────────────
{
  const sameOrder =
    ITEM_KINDS.length === ITEM_CODES.length &&
    ITEM_KINDS.every((kind, index) => ITEM_CODES[index] === kind);
  gate.check(
    "[C9] ITEM_KINDS と ITEM_CODES が要素・順序ともに一致し、基数が整合する",
    sameOrder &&
      ITEM_SLOT_RADIX === ITEM_CODES.length + 1 &&
      ITEM_SLOT_MAX === ITEM_SLOT_RADIX ** 3 - 1,
    `${ITEM_KINDS.length} 種・基数 ${ITEM_SLOT_RADIX}・上限 ${ITEM_SLOT_MAX}`,
  );
  gate.expectFail(
    "[C9-neg] 片方だけに1種足すと一致しない",
    () => {
      const extended = [...ITEM_CODES, "mushroom"];
      return (
        ITEM_KINDS.length === extended.length &&
        ITEM_KINDS.every((kind, index) => extended[index] === kind)
      );
    },
    "ITEM_CODES に1種追加",
  );
}

gate.finish("CONTENT SELFTEST");
