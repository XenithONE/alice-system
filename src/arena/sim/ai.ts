import {
  CONTROL_RANGE,
  DISENGAGE_SEC,
  FIXED_DT,
  IMMOBILE_SPEED,
  STALEMATE_RANGE,
  STALEMATE_SEC
} from "./balance";
import type {
  ArenaSim,
  BotState,
  MatchInput,
  SeatIndex,
  WeaponDef,
  WeaponState
} from "./types";
import { arenaForSim, weaponsForSim } from "./world";

interface AiMemory {
  x: number;
  z: number;
  stillFor: number;
  reverseFor: number;
  /** damageDealt + damageTaken at the last check, to spot a stalemate */
  damageMark: number;
  noDamageFor: number;
  /** seconds left of a deliberate break-off */
  disengageFor: number;
}

const memory = new WeakMap<ArenaSim, Map<SeatIndex, AiMemory>>();

function stateMemory(sim: ArenaSim, seat: SeatIndex, bot: BotState): AiMemory {
  let bySeat = memory.get(sim);
  if (!bySeat) {
    bySeat = new Map();
    memory.set(sim, bySeat);
  }
  let state = bySeat.get(seat);
  if (!state) {
    state = {
      x: bot.pos[0],
      z: bot.pos[2],
      stillFor: 0,
      reverseFor: 0,
      damageMark: 0,
      noDamageFor: 0,
      disengageFor: 0
    };
    bySeat.set(seat, state);
  }
  return state;
}

function normalize(x: number, z: number): readonly [number, number] {
  const length = Math.hypot(x, z);
  return length > Number.EPSILON ? [x / length, z / length] : [0, -1];
}

function forward(bot: BotState): readonly [number, number] {
  const [x, y, z, w] = bot.quat;
  return normalize(-2 * (x * z + w * y), -(1 - 2 * (x * x + y * y)));
}

function steerToward(
  forwardX: number,
  forwardZ: number,
  targetX: number,
  targetZ: number
): number {
  const dot = forwardX * targetX + forwardZ * targetZ;
  const cross = forwardZ * targetX - forwardX * targetZ;
  return Math.max(-1, Math.min(1, -Math.atan2(cross, dot)));
}

function wantsWeapon(
  def: WeaponDef,
  state: WeaponState | undefined,
  distance: number,
  facingDot: number
): boolean {
  if (def.action === "passive" || def.effect === "static") return false;
  if (def.effect === "clamp" && state?.clamping !== null && state?.clamping !== undefined) {
    return true;
  }
  if (def.effect === "flame") {
    return distance <= (def.coneRange ?? def.reach) && facingDot >= Math.cos(def.coneAngle ?? 0);
  }
  if (def.effect === "grind") return distance <= Math.max(1.2, def.reach + 0.8);
  if (def.effect === "impulse" || def.effect === "clamp") {
    return distance <= Math.max(1.35, def.reach + 0.8) && (state?.charge ?? 1) >= 1;
  }
  return distance <= Math.max(1.5, def.reach + 0.9);
}

export function aiInput(sim: ArenaSim, seat: SeatIndex): MatchInput {
  const state = sim.getState();
  const bot = state.bots.find((candidate) => candidate.seat === seat);
  if (!bot?.alive || state.phase !== "live") {
    return { throttle: 0, steer: 0, primary: false, secondary: false, tertiary: false, selfRight: false };
  }
  let target: BotState | null = null;
  let targetDistance = Number.POSITIVE_INFINITY;
  for (const rival of state.bots) {
    if (!rival.alive || rival.seat === seat) continue;
    const distance = Math.hypot(rival.pos[0] - bot.pos[0], rival.pos[2] - bot.pos[2]);
    if (distance < targetDistance) {
      target = rival;
      targetDistance = distance;
    }
  }
  if (!target) {
    return { throttle: 0, steer: 0, primary: false, secondary: false, tertiary: false, selfRight: bot.inverted };
  }

  const ai = stateMemory(sim, seat, bot);
  const moved = Math.hypot(bot.pos[0] - ai.x, bot.pos[2] - ai.z);
  ai.x = bot.pos[0];
  ai.z = bot.pos[2];
  if (moved < IMMOBILE_SPEED * FIXED_DT) ai.stillFor += FIXED_DT;
  else ai.stillFor = 0;
  if (ai.stillFor > 1) {
    ai.reverseFor = 0.75;
    ai.stillFor = 0;
  }
  ai.reverseFor = Math.max(0, ai.reverseFor - FIXED_DT);

  // Break off a shoving match. The stillFor test above only catches a bot that
  // is pinned solid; two machines grinding against each other keep drifting at
  // 0.2-0.5 m/s, so it never fires and they lean on each other for the rest of
  // the match. Measured before this: 21 hits in the first 87 seconds and then
  // literally nothing for the remaining 93, with the pair 1.3 m apart the whole
  // time. Spinners also need a run-up to hit hard, so backing off and charging
  // again is what a real driver does, not a concession.
  const damageNow = bot.damageDealt + bot.damageTaken;
  if (damageNow > ai.damageMark + 1) {
    ai.damageMark = damageNow;
    ai.noDamageFor = 0;
  } else if (targetDistance < STALEMATE_RANGE) {
    ai.noDamageFor += FIXED_DT;
  } else {
    ai.noDamageFor = 0;
  }
  if (ai.noDamageFor > STALEMATE_SEC) {
    ai.disengageFor = DISENGAGE_SEC;
    ai.noDamageFor = 0;
  }
  ai.disengageFor = Math.max(0, ai.disengageFor - FIXED_DT);

  const lowHp = bot.chassisHp <= bot.chassisHpMax * 0.3;
  let [targetX, targetZ] = normalize(
    target.pos[0] - bot.pos[0],
    target.pos[2] - bot.pos[2]
  );
  if (lowHp && targetDistance < CONTROL_RANGE * 2) {
    targetX = -targetX;
    targetZ = -targetZ;
  }

  const arena = arenaForSim(sim);
  if (arena?.pit) {
    const pitX = arena.pit.x - bot.pos[0];
    const pitZ = arena.pit.z - bot.pos[2];
    const pitDistance = Math.hypot(pitX, pitZ);
    const projectedX = bot.pos[0] + targetX * Math.max(arena.pit.r, targetDistance);
    const projectedZ = bot.pos[2] + targetZ * Math.max(arena.pit.r, targetDistance);
    const pathHitsPit =
      Math.abs(projectedX - arena.pit.x) < arena.pit.r * 1.5 &&
      Math.abs(projectedZ - arena.pit.z) < arena.pit.r * 1.5;
    if (pitDistance < arena.pit.r * 2.25 || pathHitsPit) {
      [targetX, targetZ] = normalize(-pitX + pitZ, -pitZ - pitX);
    }
  }
  if (arena) {
    const wallLimit = arena.size / 2 - 2;
    if (Math.abs(bot.pos[0]) > wallLimit || Math.abs(bot.pos[2]) > wallLimit) {
      [targetX, targetZ] = normalize(-bot.pos[0], -bot.pos[2]);
    }
  }

  const [forwardX, forwardZ] = forward(bot);
  const directX = target.pos[0] - bot.pos[0];
  const directZ = target.pos[2] - bot.pos[2];
  const directLength = Math.max(Math.hypot(directX, directZ), Number.EPSILON);
  const facingDot = (forwardX * directX + forwardZ * directZ) / directLength;
  let steer = steerToward(forwardX, forwardZ, targetX, targetZ);
  let throttle = Math.abs(steer) > 0.8 ? 0.35 : 1;
  if (lowHp) throttle = 0.85;
  // Back away weapon-first: keep steering at the rival so the run-up starts
  // already aimed, and so a spinner spends the retreat spinning back up.
  if (ai.disengageFor > 0) throttle = -1;
  if (ai.reverseFor > 0) {
    throttle = -1;
    steer = -steer || (seat % 2 === 0 ? 1 : -1);
  }
  let primary = false;
  let secondary = false;
  let tertiary = false;
  for (const def of weaponsForSim(sim, seat)) {
    const weaponState = bot.weapons.find((weapon) => weapon.slot === def.slot);
    const wants = wantsWeapon(def, weaponState, targetDistance, facingDot);
    if (def.slot === "primary") primary ||= wants;
    else if (def.slot === "secondary") secondary ||= wants;
    else tertiary ||= wants;
  }
  return {
    throttle,
    steer,
    primary,
    secondary,
    tertiary,
    selfRight: bot.inverted
  };
}
