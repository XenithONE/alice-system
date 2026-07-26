import { PROTOCOL_VERSION } from "./protocol";
import { MAX_DRIVES } from "../sim/balance";
import { shouldIncludeDeploy, snapshotFromState } from "./snapshot";
import type {
  BotState,
  MatchState,
  SeatIndex,
  WeaponState,
  WorldEntity
} from "../sim/types";

declare const process: { exitCode?: number };

const checks: Record<string, boolean | number> = {};
const assert = (name: string, value: boolean): void => {
  checks[name] = value;
  if (!value) throw new Error(name);
};
const bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

function weapon(index: number): WeaponState {
  return {
    partIdx: index,
    slot: index === 0 ? "primary" : index === 1 ? "secondary" : "tertiary",
    active: true,
    omega: 123.456789,
    angle: 2.3456789,
    charge: 0.87654321,
    fuel: 0.7654321,
    clamping: null
  };
}

function bot(seat: SeatIndex): BotState {
  return {
    seat,
    name: `WIRE BOT ${seat}`,
    alive: true,
    chassisHp: 987.654321,
    chassisHpMax: 1000,
    pos: [7.1234567 - seat, 0.3456789, -7.7654321 + seat],
    quat: [0.1234567, 0.2345678, 0.3456789, 0.8765432],
    vel: [12.345678, -1.234567, 9.876543],
    weapons: [weapon(0), weapon(1), weapon(2)],
    detached: [1, 4, 7],
    partCondition: Array.from({ length: 16 }, (_, index) => 1 - index / 20),
    immobileFor: 9.876543,
    damageDealt: 1234.56789,
    damageTaken: 987.65432,
    inverted: false,
    burningFor: 2.345678,
    selfRightCooldown: 7.654321,
    plant: { heat: 0.98765, charge: 0.87654, fuel: 0.76543, load: 0.65432 },
    /*
     * MAX_DRIVES of them, late in a long match. `wp` is one float per drive, so
     * a fixture pinned at four left the budget untested for exactly the builds
     * that stress it. These are deliberately the worst case
     * for the wire: the phase is ACCUMULATED, so a 180 s match at a wheel's
     * ~40 rad/s reaches four digits before the point, and that is what has to
     * fit inside the byte budget below — not a tidy 1.234.
     */
    /*
     * MAX_DRIVES of them at the magnitude a long match reaches — the phase is
     * accumulated, so 180 s at a wheel's ~40 rad/s is four figures before the
     * point, and that is what has to fit the budget below. Alternating signs
     * because a machine turning on the spot runs its sides opposite ways, which
     * wp-carries-sign checks.
     */
    drivePhases: Array.from({ length: MAX_DRIVES }, (_, index) =>
      (index % 2 === 0 ? -7213.456789 : 7198.123456) + seat + index / 100
    ),
    nettedFor: seat === 0 ? 1 : 0,
    pinnedFor: seat === 1 ? 1 : 0,
    oiledFor: seat === 2 ? 1 : 0,
    tetheredBy: seat === 3 ? 0 : null,
    disabledBy: seat === 0 ? 1 : null
  };
}

function entity(id: number, projectile: boolean): WorldEntity {
  const trapKinds = ["caltrop", "mine", "oil", "glue"] as const;
  return {
    id,
    kind: projectile ? (id % 2 === 0 ? "net" : "harpoon") : trapKinds[id % 4]!,
    owner: (id % 4) as SeatIndex,
    x: -7.987654 + id * 0.713579,
    y: 0.0123456,
    z: 7.876543 - id * 0.612345,
    yaw: 3.1415926 - id * 0.123456,
    state: id % 3
  };
}

function main(): void {
  const state: MatchState = {
    tick: 100,
    elapsed: 179.987654,
    phase: "live",
    bots: [bot(0), bot(1), bot(2), bot(3)],
    entities: [
      ...Array.from({ length: 20 }, (_, index) => entity(index + 1, false)),
      ...Array.from({ length: 4 }, (_, index) => entity(index + 100, true))
    ]
  };
  const events = [
    {
      t: "launch" as const,
      seat: 0 as SeatIndex,
      kind: "harpoon" as const,
      x: 1.234567,
      y: 0.345678,
      z: -2.345678,
      dirX: 0.123456,
      dirZ: -0.987654
    }
  ];
  const regular = snapshotFromState(state, 41, events, false);
  const keyframe = snapshotFromState(state, 41, events, true);
  const regularJson = JSON.stringify(regular);
  const keyframeJson = JSON.stringify(keyframe);
  checks.regularBytes = bytes(regular);
  checks.keyframeBytes = bytes(keyframe);
  /*
   * Both caps move, and it is worth saying why rather than just raising them.
   *
   * The fixture used to carry four drives, so the budget was never tested
   * against the builds that actually stress it — MAX_DRIVES is twelve, and
   * wp is one number per drive. Sizing the fixture honestly is what pushed
   * these past their old ceilings; the snapshot did not silently grow.
   *
   * MAX_DRIVES is what keeps it bounded: without it a guest picks the room's
   * bandwidth for everyone, since chassis-fortress geometrically takes 231
   * one-cell wheels. The phase itself is sent accumulated. Folding it to an
   * angle would have saved 144 B and cost correctness — at 20 Hz a drive moves
   * up to 18 rad between snapshots, which a wrapped value cannot express.
   *
   * Ceilings are the measurement at MAX_DRIVES rounded up to the next hundred,
   * which is how the earlier ones were set.
   */
  assert(`regular-size:${checks.regularBytes}`, bytes(regular) <= 2900);
  assert(`keyframe-size:${checks.keyframeBytes}`, bytes(keyframe) <= 4200);
  assert("quantized", !/\.\d{4,}/.test(keyframeJson));
  assert("proj-every-frame", regular.proj.length === 4 && "proj" in regular);
  assert("dv-every-frame", regular.dv === 41 && keyframe.dv === 41);
  assert("dep-omitted-steady", regular.dep === undefined);
  assert("dep-on-change", shouldIncludeDeploy(40, 41, 99));
  assert("dep-on-keyframe", shouldIncludeDeploy(41, 41, 100));
  assert("dep-not-every-frame", !shouldIncludeDeploy(41, 41, 99));
  assert("protocol-v5", PROTOCOL_VERSION === 5);

  /*
   * What the drive phases cost. Measured, not asserted from a formula: the same
   * snapshot with wp emptied, stringified the same way, subtracted. A regression
   * that quietly widens wp (six decimals, one entry per spoke rather than per
   * drive) shows up here as a number, and the budget above catches it.
   */
  const withoutPhases = {
    ...regular,
    bots: regular.bots.map((snap) => ({ ...snap, wp: [] as number[] }))
  };
  checks.wpBytes = bytes(regular) - bytes(withoutPhases);
  checks.wpBytesPerBot = +(checks.wpBytes / regular.bots.length).toFixed(1);
  checks.wpBytesPerSecondAt20Hz = checks.wpBytes * 20;
  assert(
    "wp-one-per-drive",
    regular.bots.every(
      (snap, index) => snap.wp.length === state.bots[index]!.drivePhases.length
    )
  );
  assert(
    "wp-carries-sign",
    regular.bots.every((snap) => snap.wp.some((v) => v < 0) && snap.wp.some((v) => v > 0))
  );
  // 3 dp is the contract: the drawn foot must land within a millimetre of the
  // physical one, and radius * 0.001 rad is 0.3 mm on the largest leg.
  assert(
    "wp-3dp",
    regular.bots.every((snap) =>
      snap.wp.every((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6)
    )
  );
  assert(
    "wp-not-flattened",
    regular.bots.every((snap) => new Set(snap.wp).size === snap.wp.length)
  );
  checks.longDecimals = (keyframeJson.match(/\.\d{4,}/g) ?? []).length;
  checks.regularHasDep = regular.dep === undefined ? 0 : 1;
  console.log(`G-WIRE PASS ${JSON.stringify(checks)}`);
}

try {
  main();
} catch (error) {
  console.error(`G-WIRE FAIL: ${String(error)}`);
  process.exitCode = 1;
}
