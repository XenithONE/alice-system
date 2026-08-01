/**
 * Gate: the wire.
 *
 * It drives a real host and a real guest over a real BroadcastChannel — the
 * same transport two tabs on one machine use — so the handshake, the snapshot
 * encoder, the validator, the interpolator and the input path are all executed
 * here rather than described. The validator checks are paired: every mutation
 * that must be rejected is run alongside the untouched frame that must be
 * accepted, because a validator that returns null for everything would
 * otherwise look perfect.
 *
 * Run: npx tsx src/kart/net/wireSelftest.ts
 */
import { createGate } from "../gate";
import { createKartSim } from "../sim/sim";
import { TRACKS } from "../sim/tracks";
import {
  NEUTRAL_INPUT,
  type KartInput,
  type RaceState,
} from "../sim/types";
import { SnapshotInterpolator } from "./interpolation";
import {
  FLAG_SLIPSTREAM,
  FLAG_TRICK,
  NITRO_PROTOCOL_VERSION,
  raceStateFromSnapshot,
  validateCup,
  validateEventForTest,
  IN_MAX,
  ITEM_CHARGE_MAX,
  ITEM_SLOT_MAX,
  packItems,
  unpackItems,
  validateInput,
  validateSettings,
  validateSnapshot,
  validateStart,
  type NitroSnapshot,
} from "./protocol";
import { angleDelta, headingOf, pointAt } from "../sim/track";
import {
  createGuestSession,
  createHostSession,
  DEFAULT_ROOM_SETTINGS,
} from "./session";
import { CUP_ROUNDS as CUP_ROUND_COUNT } from "../modes/gp";
import { encodeSnapshot } from "./snapshot";
import { createBroadcastChannelWire, makeRoomCode, normalizeRoomCode } from "./wire";

const gate = createGate();

const settle = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function bytes(value: unknown): number {
  return JSON.stringify(value).length;
}

function drive(throttle = 1, steer = 0, drift = false): KartInput {
  return { ...NEUTRAL_INPUT, throttle, steer, drift };
}

/**
 * Steer toward a centreline point ahead.
 *
 * The wire gates do not care where a kart goes, only that the inputs reach the
 * host and the sim keeps running — but an open-loop straight wheel leaves the
 * circuit at the first corner and parks against a wall, and then every gate
 * downstream is really measuring "how fast does a kart recover from a wall".
 * That made [W10] break on unrelated drift tuning twice.
 */
function centrelineSteer(
  view: RaceState | null,
  seat: number,
  track: import("../sim/track").Track,
): number {
  const racer = view?.racers.find((entry) => entry.id === seat);
  if (!racer) return 0;
  const s = ((racer.distance % track.length) + track.length) % track.length;
  const [aimX, , aimZ] = pointAt(track, s + 14, 0);
  const desired = headingOf(aimX - racer.x, aimZ - racer.z);
  // Negated for the same reason ai.ts is: yaw grows to the left, steer to the
  // right (see the heading convention in track.ts).
  return Math.max(-1, Math.min(1, -angleDelta(racer.yaw, desired) * 1.6));
}

// ── [W1] room codes ─────────────────────────────────────────────────────────
{
  const readable = makeRoomCode(() => 0.5);
  let rejected = 0;
  for (const bad of ["", "ABC", "ABCDEFG", "ab cde", "AB!DEF"]) {
    try {
      normalizeRoomCode(bad);
    } catch {
      rejected += 1;
    }
  }
  gate.check(
    "[W1] ルームコードの正規化（前置き除去・大文字化・不正拒否）",
    normalizeRoomCode(" nk-ab12cd ") === "AB12CD" &&
      rejected === 5 &&
      /^[A-Z2-9]{6}$/.test(readable) &&
      !/[OI01]/.test(readable),
    `生成例 ${readable}・不正 ${rejected}/5 を拒否`,
  );
}

// ── [W2] snapshot round trip and size ───────────────────────────────────────
let referenceSnapshot: NitroSnapshot;
{
  const sim = createKartSim({
    trackId: TRACKS[1]!.id,
    laps: 3,
    seed: 4242,
    racers: Array.from({ length: 8 }, (_, index) => ({
      name: `R${index}`,
      cpu: true,
      cpuLevel: 3,
      livery: index,
    })),
  });
  // Far enough in that items are in the air and bananas are on the road.
  for (let i = 0; i < 60 * 40; i += 1) sim.step();
  const state = sim.getState();
  referenceSnapshot = { ...encodeSnapshot(state), events: [] };

  const wire = JSON.stringify(referenceSnapshot);
  const parsed = validateSnapshot(JSON.parse(wire));
  gate.check(
    "[W2] スナップショットが JSON 往復でバイト完全一致",
    parsed !== null && JSON.stringify(parsed) === wire,
    `${wire.length}B・${state.racers.length}台・弾${state.projectiles.length}・落下物${state.hazards.length}`,
  );

  // 20 snapshots a second to three guests. The readable-key version of this
  // frame measured 3.4 KB, which is 550 kbps up; the budget is what forces the
  // one-character keys to stay.
  const budget = 2600;
  gate.check(
    "[W2b] スナップショット予算内（8台・満載）",
    wire.length < budget,
    `${wire.length}B / 上限 ${budget}B（20Hz×3人で ${((wire.length * 20 * 3) / 1024).toFixed(0)} KB/s）`,
  );

  const roster = {
    names: state.racers.map((racer) => racer.name),
    cpu: state.racers.map((racer) => racer.cpu),
    liveries: state.racers.map((racer) => racer.livery),
    trackId: state.trackId,
    laps: state.laps,
  };
  const rebuilt = raceStateFromSnapshot(parsed!, roster);
  let worst = 0;
  for (const racer of state.racers) {
    const mirror = rebuilt.racers.find((entry) => entry.id === racer.id)!;
    worst = Math.max(
      worst,
      Math.abs(mirror.x - racer.x),
      Math.abs(mirror.z - racer.z),
      Math.abs(mirror.distance - racer.distance),
    );
  }
  gate.check(
    "[W3] 復元した RaceState がホストの状態と一致（量子化誤差のみ）",
    worst < 0.02 &&
      rebuilt.racers.every(
        (racer, index) =>
          JSON.stringify(racer.items) ===
            JSON.stringify(state.racers[index]!.items) &&
          racer.lap === state.racers[index]!.lap &&
          racer.place === state.racers[index]!.place &&
          racer.finished === state.racers[index]!.finished,
      ),
    `最大誤差 ${worst.toFixed(4)}m`,
  );
}

// ── [W4] the validator actually discriminates ───────────────────────────────
{
  gate.check(
    "[W4a] 正常なスナップショットは受理される（拒否器が全部落としていない証明）",
    validateSnapshot(JSON.parse(JSON.stringify(referenceSnapshot))) !== null,
    "無改変フレーム",
  );

  const mutations: { name: string; mutate: (snapshot: any) => void }[] = [
    { name: "x が NaN", mutate: (s) => (s.racers[0].x = Number.NaN) },
    { name: "x が Infinity", mutate: (s) => (s.racers[0].x = Number.POSITIVE_INFINITY) },
    { name: "座標が範囲外", mutate: (s) => (s.racers[0].z = 999_999) },
    { name: "席番号が範囲外", mutate: (s) => (s.racers[0].i = 99) },
    { name: "順位が 0", mutate: (s) => (s.racers[0].e = 0) },
    { name: "周回が 0", mutate: (s) => (s.racers[0].k = 0) },
    /*
     * Was 42, which the single-slot encoding could not represent. The packed
     * word can: 42 is three perfectly ordinary slots, and this mutation went
     * on reporting PASS while testing nothing — the same way [W4c]'s f:99 did.
     */
    { name: "アイテム枠が範囲外", mutate: (s) => (s.racers[0].m = ITEM_SLOT_MAX + 1) },
    { name: "アイテム枠が負", mutate: (s) => (s.racers[0].m = -1) },
    { name: "チャージが範囲外", mutate: (s) => (s.racers[0].c = ITEM_CHARGE_MAX + 1) },
    { name: "必須フィールド欠落", mutate: (s) => delete s.racers[0].v },
    { name: "数値が文字列", mutate: (s) => (s.racers[0].a = "0.5") },
    { name: "racers が空", mutate: (s) => (s.racers.length = 0) },
    { name: "racers が過剰", mutate: (s) => s.racers.push({ ...s.racers[0] }) },
    { name: "tick が小数", mutate: (s) => (s.tick = 1.5) },
    { name: "phase 番号が範囲外", mutate: (s) => (s.ph = 7) },
    { name: "弾の種別が範囲外", mutate: (s) => s.shots.push({ ...s.racers[0], i: 1, t: 9, o: 0, x: 0, y: 0, z: 0, a: 0 }) },
    { name: "イベントの種別が未知", mutate: (s) => s.events.push({ k: "explode" }) },
    { name: "イベントの席番号が不正", mutate: (s) => s.events.push({ k: "respawn", racer: -3 }) },
    { name: "hit の cause が未知", mutate: (s) => s.events.push({ k: "hit", racer: 0, by: null, cause: "laser", x: 0, y: 0, z: 0 }) },
  ];
  const survivors: string[] = [];
  for (const mutation of mutations) {
    const copy = JSON.parse(JSON.stringify(referenceSnapshot));
    mutation.mutate(copy);
    if (validateSnapshot(copy) !== null) survivors.push(mutation.name);
  }
  gate.check(
    "[W4b] 壊れたスナップショットを全て拒否",
    survivors.length === 0,
    survivors.length === 0
      ? `${mutations.length} 種類の破壊を全て検出`
      : `通過してしまった: ${survivors.join(" / ")}`,
  );

  const badInputs = [
    { q: -1, t: 1, b: 0, s: 0, f: 0 },
    { q: 1, t: 2, b: 0, s: 0, f: 0 },
    { q: 1, t: 1, b: 0, s: 5, f: 0 },
    /*
     * Was 99, which the three-bit word could not represent. Seven bits can:
     * 99 is drift+item0+skill+gimmick, a perfectly ordinary frame, and this
     * gate would have gone on reporting PASS while testing nothing.
     */
    { q: 1, t: 1, b: 0, s: 0, f: IN_MAX + 1 },
    { q: 1, t: 1, b: 0, s: 0, f: 999 },
    { q: 1, t: Number.NaN, b: 0, s: 0, f: 0 },
    { q: 1.5, t: 1, b: 0, s: 0, f: 0 },
  ];
  gate.check(
    "[W4c] 入力フレームの検証（正常受理・異常拒否）",
    validateInput({ q: 3, t: 1, b: 0, s: -0.5, f: 3 }) !== null &&
      validateInput({ q: 4, t: 1, b: 0, s: 0, f: IN_MAX }) !== null &&
      badInputs.every((frame) => validateInput(frame) === null),
    `f=${IN_MAX} 受理・異常 ${badInputs.length} 件を拒否`,
  );

  // ── [W14] the three-slot pack survives every value it can hold ────────────
  /*
   * Exhaustive, because it can be: every (slot triple × charge triple) the
   * encoding admits, round-tripped. A packed field is exactly the kind of
   * thing that works for the cases someone thought to try and loses the third
   * slot for the ones they did not.
   */
  {
    let mismatches = 0;
    let checked = 0;
    for (let m = 0; m <= ITEM_SLOT_MAX; m += 1) {
      for (let c = 0; c <= ITEM_CHARGE_MAX; c += 1) {
        const slots = unpackItems(m, c);
        const again = packItems(slots);
        // Charges are only meaningful where an item sits, and an occupied slot
        // always carries at least one, so compare through a re-unpack.
        const round = unpackItems(again.m, again.c);
        checked += 1;
        if (JSON.stringify(round) !== JSON.stringify(slots)) mismatches += 1;
      }
    }
    gate.check(
      "[W14] 3枠アイテムの詰め直しが全数で往復する",
      mismatches === 0,
      `${checked} 通りを検査・不一致 ${mismatches}`,
    );
    gate.expectFail(
      "[W14-neg] 3枠目を落とす詰め方は往復しない",
      () => {
        const broken = (items: readonly (ReturnType<typeof unpackItems>)[0][]) => {
          const two = [items[0] ?? null, items[1] ?? null, null];
          return packItems(two);
        };
        const sample = unpackItems(ITEM_SLOT_MAX, ITEM_CHARGE_MAX);
        const again = broken(sample);
        return (
          JSON.stringify(unpackItems(again.m, again.c)) ===
          JSON.stringify(sample)
        );
      },
      "3枠目を捨てる詰め方",
    );
  }

  gate.check(
    "[W4d] 部屋設定の検証（人間席がグリッドを超えない等）",
    validateSettings(DEFAULT_ROOM_SETTINGS) !== null &&
      validateSettings({ ...DEFAULT_ROOM_SETTINGS, laps: 0 }) === null &&
      validateSettings({ ...DEFAULT_ROOM_SETTINGS, racerCount: 9 }) === null &&
      validateSettings({
        ...DEFAULT_ROOM_SETTINGS,
        racerCount: 2,
        playerCount: 4,
      }) === null,
    "laps=0 / racerCount=9 / playerCount>racerCount を拒否",
  );

  // ── v2/v3 fields ──────────────────────────────────────────────────────────
  gate.check(
    "[W4e] バージョン定数が 3（コメント慣例とゲートの同期）",
    NITRO_PROTOCOL_VERSION === 3,
    `v${NITRO_PROTOCOL_VERSION}`,
  );
  gate.check(
    "[W4f] v2 設定フィールドの変異を拒否・正常は受理",
    validateSettings({ ...DEFAULT_ROOM_SETTINGS, speedClass: 5 }) === null &&
      validateSettings({ ...DEFAULT_ROOM_SETTINGS, weather: 9 }) === null &&
      validateSettings({ ...DEFAULT_ROOM_SETTINGS, mirror: "yes" }) === null &&
      validateSettings({ ...DEFAULT_ROOM_SETTINGS, gp: 1 }) === null &&
      validateSettings({
        ...DEFAULT_ROOM_SETTINGS,
        speedClass: 2,
        mirror: true,
        weather: 1,
        gp: true,
      }) !== null,
    "speedClass=5 / weather=9 / mirror='yes' / gp=1 を拒否",
  );
  {
    // f: 255 (all v2 bits) must pass; 256 must not.
    const copy = JSON.parse(JSON.stringify(referenceSnapshot));
    copy.racers[0].f = FLAG_TRICK | FLAG_SLIPSTREAM | 31;
    const ok255 = validateSnapshot(copy) !== null;
    copy.racers[0].f = 256;
    const bad256 = validateSnapshot(copy) === null;
    gate.check(
      "[W4g] v2 フラグ帯（trick=64/slipstream=128）受理・範囲外拒否",
      ok255 && bad256,
      `f=255 受理 ${ok255} / f=256 拒否 ${bad256}`,
    );
  }
  {
    const okTrick =
      validateEventForTest({ k: "trick", racer: 2 }) !== null &&
      validateEventForTest({ k: "trick", racer: 9 }) === null;
    const okDraft =
      validateEventForTest({ k: "boost", racer: 1, source: "draft", tier: 0 }) !== null &&
      validateEventForTest({ k: "boost", racer: 1, source: "warp", tier: 0 }) === null;
    gate.check(
      "[W4h] v2 イベント（trick / draft boost）受理・未知は拒否",
      okTrick && okDraft,
      `trick ${okTrick} / draft ${okDraft}`,
    );
  }
  {
    const base = {
      settings: { ...DEFAULT_ROOM_SETTINGS, racerCount: 2 },
      names: ["A", "B"],
      cpu: [false, true],
      liveries: [0, 1],
      round: 1,
      rounds: 3,
    };
    const good = validateStart(base) !== null;
    const badRound = validateStart({ ...base, round: 3 }) === null;
    const badRounds = validateStart({ ...base, rounds: 0 }) === null;
    gate.check(
      "[W4i] v2 start の round/rounds 検証",
      good && badRound && badRounds,
      `round<rounds 受理 / round>=rounds 拒否 / rounds=0 拒否`,
    );
  }
  {
    const good = validateCup({ r: 2, n: 3, p: [10, 8], f: false }, 2) !== null;
    const wrongLength = validateCup({ r: 2, n: 3, p: [10], f: false }, 2) === null;
    const negative = validateCup({ r: 2, n: 3, p: [10, -1], f: false }, 2) === null;
    const inverted = validateCup({ r: 4, n: 3, p: [10, 8], f: false }, 2) === null;
    const stringly = validateCup({ r: 2, n: 3, p: [10, "8"], f: false }, 2) === null;
    gate.check(
      "[W4j] v2 カップブロック検証（長さ・負値・r>n・文字列を拒否）",
      good && wrongLength && negative && inverted && stringly,
      "正常受理＋4種の破壊を拒否",
    );
  }
}

// ── [W5] interpolation ──────────────────────────────────────────────────────
{
  const interpolator = new SnapshotInterpolator(0.1, 8);
  const base = referenceSnapshot;
  const frameAt = (tick: number, elapsed: number, x: number): NitroSnapshot => ({
    ...base,
    tick,
    elapsed,
    racers: base.racers.map((racer, index) =>
      index === 0 ? { ...racer, x, a: index === 0 ? 0 : racer.a } : racer,
    ),
    events: [{ k: "respawn", racer: 0 }],
  });
  interpolator.push(frameAt(100, 10.0, 0));
  interpolator.push(frameAt(103, 10.05, 10));
  interpolator.push(frameAt(106, 10.1, 20));
  const first = interpolator.sample()!;
  const second = interpolator.sample()!;
  const midpoint = first.racers[0]!.x;
  gate.check(
    "[W5] 100ms 遅延で中間姿勢を返し、イベントは一度だけ流す",
    midpoint > -0.001 &&
      midpoint < 0.001 &&
      first.events.length === 1 &&
      second.events.length === 0,
    `x=${midpoint.toFixed(3)}（10.0 と 10.05 の間・目標 10.0）・イベント ${first.events.length}→${second.events.length}`,
  );

  const wrap = new SnapshotInterpolator(0, 4);
  wrap.push({ ...base, tick: 1, elapsed: 1, racers: [{ ...base.racers[0]!, a: 3.0 }] });
  wrap.push({ ...base, tick: 2, elapsed: 2, racers: [{ ...base.racers[0]!, a: -3.0 }] });
  const wrapped = wrap.sample()!;
  gate.check(
    "[W5b] ヨー角は近い方向に補間する（π をまたいで逆回転しない）",
    Math.abs(wrapped.racers[0]!.a) > 3.0 || Math.abs(wrapped.racers[0]!.a) === 3,
    `3.0 → -3.0 の補間結果 ${wrapped.racers[0]!.a.toFixed(3)}`,
  );
}

// ── [W6..W9] a real host and a real guest ───────────────────────────────────
async function integration(): Promise<void> {
  const room = makeRoomCode(() => 0.3);
  const host = await createHostSession({
    roomCode: room,
    name: "HOST",
    wire: createBroadcastChannelWire(),
    // Two karts only: a CPU on the grid behind would shove the coasting guest
    // forward and the coast phase would stop measuring the input stream.
    settings: { playerCount: 2, racerCount: 2, laps: 1, cpuLevel: 2, seed: 99 },
  });

  let guestLobbySeats = 0;
  let guestStarted = false;
  const guest = await createGuestSession({
    roomCode: room,
    name: "GUEST",
    wire: createBroadcastChannelWire(),
    callbacks: {
      onLobby: (lobby) => {
        guestLobbySeats = lobby.seats.filter(
          (seat) => seat.occupant === "guest",
        ).length;
      },
      onStart: () => {
        guestStarted = true;
      },
    },
  });
  await settle(60);

  gate.check(
    "[W6] ゲストが着席し、ロビーが両者に配られる",
    guest.seat === 1 && guestLobbySeats === 1,
    `seat=${guest.seat}・ロビーのゲスト席 ${guestLobbySeats}`,
  );

  host.beginRace();
  await settle(40);
  gate.check(
    "[W7] start がゲストに届く",
    guestStarted && guest.racing,
    `started=${guestStarted}`,
  );

  const step = 1 / 60;
  /*
   * Two phases with opposite instructions, so "the input arrived" cannot be
   * confused with "the kart happened to move". The guest coasts for three
   * seconds after the lights (must stay put), then floors it (must go). A
   * one-sided test passes just as well when the host is quietly ignoring the
   * stream and the CPU fallback is driving.
   */
  const COUNTDOWN_TICKS = 220;
  const COAST_UNTIL = COUNTDOWN_TICKS + 180;
  let sawGuestDrift = false;
  let coastDistance = 0;
  for (let i = 0; i < 60 * 14; i += 1) {
    const counting = i < COUNTDOWN_TICKS;
    const coasting = !counting && i < COAST_UNTIL;
    const turning = i > COAST_UNTIL + 120 && i < COAST_UNTIL + 190;
    host.sendInput(drive(counting ? 0 : 1, centrelineSteer(host.view(), 0, host.track)));
    // Both cars follow the line; the guest adds a lane change and a drift in
    // the turning window so [W9] has a drift to see and [W10] hands the CPU a
    // kart that is on the road rather than one wedged against a barrier.
    const line = centrelineSteer(guest.view(), 1, guest.track);
    guest.sendInput(
      coasting || counting
        ? drive(0, line)
        : drive(1, Math.max(-1, Math.min(1, line + (turning ? 0.45 : 0))), turning),
    );
    host.tick(step);
    guest.tick(step);
    if ((host.view()?.racers[1]?.driftDir ?? 0) !== 0) sawGuestDrift = true;
    if (i === COAST_UNTIL) {
      coastDistance = host.view()!.racers[1]!.distance;
    }
    if (i % 6 === 0) await settle(0);
  }
  await settle(40);

  const hostView = host.view()!;
  const guestView = guest.view();
  gate.check(
    "[W8] ゲストがホストのレースを再生している",
    guestView !== null &&
      guestView.racers.length === hostView.racers.length &&
      guestView.racers[0]!.distance > 30,
    guestView
      ? `ゲスト側 ${guestView.racers.length}台・先頭距離 ${guestView.racers[0]!.distance.toFixed(1)}m（ホスト ${hostView.racers[0]!.distance.toFixed(1)}m）`
      : "view が null",
  );

  /*
   * Measured in seconds, not metres. The buffer is a duration — 100 ms of
   * interpolation plus up to one 50 ms snapshot interval — so a metre budget
   * is really a speed budget in disguise, and it silently tightened the moment
   * these karts started following the racing line instead of ploughing into a
   * barrier at walking pace.
   */
  const lagMetres = guestView
    ? Math.abs(hostView.racers[0]!.distance - guestView.racers[0]!.distance)
    : Infinity;
  const hostSpeed = Math.max(1, Math.abs(hostView.racers[0]!.speed));
  const lagSeconds = lagMetres / hostSpeed;
  gate.check(
    "[W8b] 遅延が補間バッファ＋1スナップショット間隔に収まる",
    lagSeconds < 0.22,
    `${(lagSeconds * 1000).toFixed(0)}ms（${lagMetres.toFixed(2)}m / ${hostSpeed.toFixed(1)}u/s・許容 220ms）`,
  );

  const guestKart = hostView.racers.find((racer) => racer.id === 1)!;
  gate.check(
    "[W9] ゲストの入力がホストのシムを動かしている（アクセルを離せば止まり、踏めば進む）",
    coastDistance < 0.5 && guestKart.distance - coastDistance > 40 && sawGuestDrift,
    `惰性3秒 ${coastDistance.toFixed(2)}m → 加速後 ${(guestKart.distance - coastDistance).toFixed(1)}m・ドリフト到達 ${sawGuestDrift}`,
  );

  // A guest that vanishes must not park its kart across the circuit.
  const before = guestKart.distance;
  guest.dispose();
  await settle(60);
  for (let i = 0; i < 60 * 4; i += 1) {
    host.sendInput(drive(1, centrelineSteer(host.view(), 0, host.track)));
    host.tick(step);
    if (i % 12 === 0) await settle(0);
  }
  const orphan = host.view()!.racers.find((racer) => racer.id === 1)!;
  gate.check(
    "[W10] ゲスト切断後、その車はオートパイロットで走り続ける",
    orphan.distance - before > 40,
    `切断後4秒で ${(orphan.distance - before).toFixed(1)}m 前進` +
      `（速度 ${orphan.speed.toFixed(1)} offRoad=${orphan.offRoad} spin=${orphan.spinTimer.toFixed(2)}）`,
  );

  host.dispose();
  await settle(30);
}

// ── [W12] a real two-round grand prix over the real transport ──────────────
/**
 * Minimal self-steering: aim at a centreline point ahead. Both humans finish
 * a one-lap race with it, which is all the cup lifecycle needs — the CPUS'
 * quality is headlessSelftest's business, not this gate's.
 */
function steerFor(
  view: RaceState | null,
  seat: number,
  track: import("../sim/track").Track,
): KartInput {
  return drive(1, centrelineSteer(view, seat, track));
}

async function twoRoundCup(): Promise<void> {
  const room = makeRoomCode(() => 0.42);
  const host = await createHostSession({
    roomCode: room,
    name: "HOST",
    wire: createBroadcastChannelWire(),
    settings: {
      playerCount: 2,
      racerCount: 2,
      laps: 1,
      cpuLevel: 3,
      seed: 424242,
      gp: true,
    },
  });
  let guestStarts = 0;
  const guest = await createGuestSession({
    roomCode: room,
    name: "GUEST",
    wire: createBroadcastChannelWire(),
    livery: 5,
    callbacks: {
      onStart: () => {
        guestStarts += 1;
      },
    },
  });
  await settle(60);

  host.beginRace();
  await settle(60);
  const round1Track = guest.track.spec.id;

  const step = 1 / 60;
  async function raceToResult(maxSeconds: number): Promise<boolean> {
    for (let i = 0; i < 60 * maxSeconds; i += 1) {
      host.sendInput(steerFor(host.view(), 0, host.track));
      guest.sendInput(steerFor(guest.view(), 1, guest.track));
      host.tick(step);
      guest.tick(step);
      if (i % 6 === 0) await settle(0);
      if (host.result()) return true;
    }
    return false;
  }

  const round1Done = await raceToResult(120);
  await settle(80);
  const cup1 = guest.cup();
  gate.check(
    "[W12a] 第1戦が完走しゲストへカップ情報（f=false）が届く",
    round1Done && cup1 !== null && cup1.rounds === CUP_ROUND_COUNT && !cup1.finished,
    `done=${round1Done} cup=${cup1 ? `r${cup1.round + 1}/${cup1.rounds} fin=${cup1.finished}` : "null"}`,
  );

  const restarted = host.beginRace();
  await settle(80);
  gate.check(
    "[W12b] 次ラウンド開始: ゲストの result が消え、コースが切り替わる",
    restarted &&
      guestStarts === 2 &&
      guest.result() === null &&
      guest.racing &&
      guest.track.spec.id !== round1Track,
    `starts=${guestStarts} result=${guest.result() === null ? "null" : "stale!"} track ${round1Track}→${guest.track.spec.id}`,
  );

  const round2Done = await raceToResult(120);
  await settle(80);
  const cup2 = guest.cup();
  const hostCup = host.cup();
  gate.check(
    "[W12c] 第2戦後: 双方のカップ集計が一致し、ポイントが加算されている",
    round2Done &&
      cup2 !== null &&
      hostCup !== null &&
      JSON.stringify(cup2.points) === JSON.stringify(hostCup.points) &&
      cup2.points.reduce((a, b) => a + b, 0) === 36,
    `points=${JSON.stringify(cup2?.points)} host=${JSON.stringify(hostCup?.points)}（2戦×(10+8)=36）`,
  );

  guest.dispose();
  host.dispose();
  await settle(30);
}

// ── [W11] the version handshake refuses, rather than degrading ─────────────
async function versionRefusal(): Promise<void> {
  const room = makeRoomCode(() => 0.7);
  const host = await createHostSession({
    roomCode: room,
    name: "HOST",
    wire: createBroadcastChannelWire(),
    settings: { playerCount: 2, racerCount: 4 },
  });

  const wire = createBroadcastChannelWire();
  const connection = await wire.join(room);
  const reply = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("(応答なし)"), 2_000);
    connection.onMessage((payload) => {
      const message = payload as { t?: string; reason?: string };
      if (message?.t === "reject") {
        clearTimeout(timer);
        resolve(message.reason ?? "reject");
      } else if (message?.t === "welcome") {
        clearTimeout(timer);
        resolve("WELCOMED");
      }
    });
    connection.send({
      t: "hello",
      v: NITRO_PROTOCOL_VERSION + 1,
      name: "OLD",
    });
  });
  gate.check(
    "[W11] 版が違うゲストは黙って劣化せず明示的に拒否される",
    reply !== "WELCOMED" && reply !== "(応答なし)",
    reply,
  );
  wire.dispose();
  host.dispose();
  await settle(20);
}

async function main(): Promise<void> {
  if (typeof BroadcastChannel === "undefined") {
    gate.check("[W6..W12] BroadcastChannel が使える", false, "この実行環境には無い");
  } else {
    await integration();
    await twoRoundCup();
    await versionRefusal();
  }
  gate.finish("WIRE SELFTEST");
  // Node keeps BroadcastChannel handles alive; the gate has said its piece.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}

declare const process: { exitCode?: number; exit(code: number): never };

void main();
