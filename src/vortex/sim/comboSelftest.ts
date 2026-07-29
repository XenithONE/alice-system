/**
 * Gate: combos fire when they should, refuse when they should not, and add
 * nothing to the wire.
 *
 * The two failure modes this file exists for:
 * - Ordering. Detection reads the window BEFORE the opener write, so a
 *   skill can never combo with its own activation. That invariant is one
 *   misplaced line away from being false, and no compiler checks statement
 *   order — only a measurement does ([CB4]).
 * - The silent guest freeze. A SimEvent variant that isSimEvent does not
 *   recognise is dropped by the guest dispatcher with a bare return; hosts
 *   and solo players look fine while guests hang on their last snapshot.
 *   [CB6] round-trips a real combo event through the real host-message
 *   validator, so removing the protocol case turns this gate red instead of
 *   turning guests to stone.
 *
 * Wire cost is measured, not asserted from belief ([CB7]): the top's
 * serialized key set and the snapshot's byte length are compared with the
 * combo window open versus closed on the same deterministic run. Byte
 * length via TextEncoder — JSON.stringify().length counts UTF-16 units,
 * not bytes.
 *
 * Run: npx tsx src/vortex/sim/comboSelftest.ts
 */
import { RESOLVED_COMBOS } from "./comboAdapter";
import { createVortexSim } from "./index";
import { createSimFixtureBuild } from "./selftestFixture";
import { isHostMessage, VORTEX_PROTOCOL_VERSION } from "../net/protocol";
import { snapshotFromSim } from "../net/snapshot";
import type {
  ResolvedActiveSkill,
  SeatIndex,
  SimEvent,
  VortexSim,
} from "./types";

declare const process: { exitCode?: number };

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

/*
 * The pair under test comes from the live table, so this gate follows the
 * content: chain-ignition (burst-drive → kinetic-pulse, +14 spin) — chosen
 * because its bonus lands in TopState.spin, which the state readback exposes.
 */
const COMBO = RESOLVED_COMBOS.find((combo) => combo.id === "chain-ignition")!;

function fixtureSkill(id: string): ResolvedActiveSkill {
  return {
    id,
    name: id,
    cooldownSec: 1,
    charges: -1,
    conditions: [],
    // Deliberately inert: the gate measures the COMBO's bonus, so the
    // skills themselves must not move the observable.
    effects: [{ type: "attack-boost", durationSec: 0.1, multiplier: 1.01 }],
  };
}

async function makeSim(): Promise<VortexSim> {
  return createVortexSim({
    seed: 0xc0b0,
    builds: [
      createSimFixtureBuild(0, {
        activeGroups: {
          crest: [fixtureSkill(COMBO.opener)],
          crown: [fixtureSkill(COMBO.finisher)],
        },
      }),
      createSimFixtureBuild(1),
    ],
    teamIds: [0, 1],
    launchPower: [1, 1],
    cpuSeats: [],
    arenaId: "wide-dish",
    countdownSec: 0,
    suddenDeathSec: 300,
    maxDurationSec: 600,
  });
}

function spinOf(sim: VortexSim, seat: number): number {
  return sim.getState().tops.find((top) => top.seat === seat)?.spin ?? 0;
}

function drainComboEvents(sim: VortexSim): SimEvent[] {
  return sim.drainEvents().filter((event) => event.type === "combo");
}

async function main(): Promise<void> {
  check(
    "[CB0] コンボ表の全ペアが実在スキルを指し自己ペアでない",
    RESOLVED_COMBOS.length === 12 &&
      RESOLVED_COMBOS.every(
        (combo) =>
          combo.opener !== combo.finisher &&
          combo.windowSec > 0 &&
          combo.effects.length > 0,
      ) &&
      new Set(RESOLVED_COMBOS.map((combo) => combo.id)).size === 12,
    `${RESOLVED_COMBOS.length} 組・窓 ${Math.min(
      ...RESOLVED_COMBOS.map((combo) => combo.windowSec),
    ).toFixed(2)}〜${Math.max(
      ...RESOLVED_COMBOS.map((combo) => combo.windowSec),
    ).toFixed(2)}s`,
  );

  // --- the happy path, measured on spin ---------------------------------
  {
    const sim = await makeSim();
    try {
      for (let step = 0; step < 10; step += 1) sim.step();
      sim.drainEvents();
      sim.activate(0 as SeatIndex, 1);
      sim.step();
      const before = spinOf(sim, 0);
      sim.activate(0 as SeatIndex, 2);
      sim.step();
      const events = drainComboEvents(sim);
      const after = spinOf(sim, 0);
      check(
        "[CB1] 窓内の追撃でコンボが成立しイベントが出る",
        events.length === 1 &&
          events[0]!.type === "combo" &&
          events[0]!.comboId === COMBO.id,
        `combo イベント ${events.length} 件 (${(events[0] as { comboId?: string })?.comboId ?? "なし"})`,
      );
      check(
        "[CB2] コンボ効果が実際に適用される（spin +14）",
        after - before > 10,
        `spin ${before.toFixed(1)} -> ${after.toFixed(1)}（+${(after - before).toFixed(1)}）`,
      );
    } finally {
      sim.dispose();
    }
  }

  // --- window expiry -----------------------------------------------------
  {
    const sim = await makeSim();
    try {
      for (let step = 0; step < 10; step += 1) sim.step();
      sim.activate(0 as SeatIndex, 1);
      const expiry = Math.ceil((COMBO.windowSec + 0.2) * 60);
      for (let step = 0; step < expiry; step += 1) sim.step();
      sim.drainEvents();
      sim.activate(0 as SeatIndex, 2);
      sim.step();
      const events = drainComboEvents(sim);
      check(
        "[CB3] 窓が閉じた後の追撃は成立しない",
        events.length === 0,
        `${COMBO.windowSec.toFixed(2)}s+0.2s 後の追撃 → combo ${events.length} 件`,
      );
    } finally {
      sim.dispose();
    }
  }

  // --- ordering: reversed and self ---------------------------------------
  {
    const sim = await makeSim();
    try {
      for (let step = 0; step < 10; step += 1) sim.step();
      sim.drainEvents();
      // finisher first, opener second — the directed pair must not fire.
      sim.activate(0 as SeatIndex, 2);
      sim.step();
      sim.activate(0 as SeatIndex, 1);
      sim.step();
      const reversed = drainComboEvents(sim);
      // opener twice — the window written by the first activation must not
      // be satisfied by the second unless the table says opener==finisher,
      // which CB0 already forbids.
      sim.activate(0 as SeatIndex, 1);
      sim.step();
      const doubled = drainComboEvents(sim);
      check(
        "[CB4] 逆順・同スキル連打ではコンボしない",
        reversed.length === 0 && doubled.length === 0,
        `逆順 ${reversed.length} 件・連打 ${doubled.length} 件`,
      );
    } finally {
      sim.dispose();
    }
  }

  // --- wire: validator accepts, snapshot unchanged ------------------------
  {
    /*
     * Twin-sim protocol, because a single-sim before/after compares two
     * different moments: the first attempt measured +12B and the delta was
     * the ACTIVATION's cooldown digits, not the window. Two sims share the
     * seed; only one fires the opener. The opener is inert (attack-boost
     * 1.01 for 0.1s, no impulse), its 1s cooldown is stepped past, and both
     * event queues are drained — so at the comparison tick the only host
     * state that differs is the combo window itself. The wire must not see
     * it: byte-for-byte equality, not "roughly equal".
     */
    const control = await makeSim();
    const sim = await makeSim();
    try {
      for (let step = 0; step < 10; step += 1) {
        control.step();
        sim.step();
      }
      sim.activate(0 as SeatIndex, 1); // window opens on this host only
      // Past the 1s cooldown (60 ticks) and far inside the 2.17s window.
      for (let step = 0; step < 66; step += 1) {
        control.step();
        sim.step();
      }
      control.drainEvents();
      sim.drainEvents();
      const closedSnapshot = snapshotFromSim(control);
      const openSnapshot = snapshotFromSim(sim);
      const closedKeys = Object.keys(closedSnapshot.tops[0]!).sort().join(",");
      const openKeys = Object.keys(openSnapshot.tops[0]!).sort().join(",");
      const closedBytes = new TextEncoder().encode(
        JSON.stringify(closedSnapshot),
      ).byteLength;
      const openBytes = new TextEncoder().encode(
        JSON.stringify(openSnapshot),
      ).byteLength;
      check(
        "[CB5] コンボ窓はスナップショットに1バイトも足さない",
        openKeys === closedKeys && openBytes === closedBytes,
        `キー集合 一致=${openKeys === closedKeys} ／ 窓なし ${closedBytes}B = 窓あり ${openBytes}B`,
      );
      control.dispose();

      sim.activate(0 as SeatIndex, 2);
      sim.step();
      const snapshotWithCombo = snapshotFromSim(sim);
      const message = {
        v: VORTEX_PROTOCOL_VERSION,
        t: "snapshot" as const,
        snapshot: snapshotWithCombo,
      };
      const comboEvents = (snapshotWithCombo.events ?? []).filter(
        (event) => event.type === "combo",
      );
      check(
        "[CB6] combo イベント入りスナップショットが実物の検証器を通る",
        comboEvents.length === 1 && isHostMessage(message),
        `combo ${comboEvents.length} 件・isHostMessage=${isHostMessage(message)}` +
          `（このcaseを protocol から消すとゲストは無言で固まる）`,
      );
    } finally {
      sim.dispose();
    }
  }

  if (failures.length > 0) {
    console.log(`COMBO SELFTEST FAIL — ${failures.join(" / ")}`);
    process.exitCode = 1;
  } else {
    console.log("COMBO SELFTEST PASS");
  }
}

void main();
