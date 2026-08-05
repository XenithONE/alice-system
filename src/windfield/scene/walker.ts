import { FIELD, facing, heightAt, strafe, turnTo, yawTowards } from "../field";

/**
 * The reader, on the ground.
 *
 * Everything trigonometric is borrowed from field.ts rather than written here.
 * That is the whole discipline: this file decides WHEN to move and field.ts
 * decides WHICH WAY, so a sign error has one place to be and one gate to catch
 * it. ARENA arrived at the same split after a heading bug that made a machine
 * strafe into the screen.
 */

export interface Keys {
  forward: number;
  strafe: number;
  run: boolean;
}

export interface WalkerState {
  x: number;
  z: number;
  y: number;
  /** Where the body is pointing. Turns toward the direction of travel. */
  yaw: number;
  /** Metres per second, for the footstep cadence and the grass push. */
  speed: number;
}

/** Metres per second. A walk, and a jog — not a sprint; this is a field. */
export const PACE = { walk: 3.6, run: 7.2, turn: 7.5, accel: 14 } as const;

/**
 * The only rescue in the whole page, and the shape of it is deliberate.
 *
 * HARBOR's hardest lesson was that automatic correction is worse than the
 * problem: a nudge that fights the reader's input is indistinguishable from
 * broken controls. So this (a) moves the position and nothing else, (b) is
 * never exclusive with input — it does not lock or interrupt anything, and
 * (c) triggers at a radius the field does not contain. 240 m from the centre
 * of a 96 m field means the reader has left the world entirely, which can only
 * happen if something upstream produced a NaN.
 */
export const RESCUE_RADIUS = 240;

export function createWalker(spawnX: number, spawnZ: number, field: Float32Array): WalkerState {
  return {
    x: spawnX,
    z: spawnZ,
    y: heightAt(field, spawnX, spawnZ),
    yaw: yawTowards(-spawnX, -spawnZ),
    speed: 0
  };
}

/**
 * One step of walking.
 *
 * `cameraYaw` is what "forward" means: the reader presses W to go the way they
 * are looking, which is the convention every third-person game uses and the
 * one that stops the controls inverting when the camera swings round.
 */
export function step(
  walker: WalkerState,
  keys: Keys,
  cameraYaw: number,
  dt: number,
  field: Float32Array
): void {
  const want = Math.hypot(keys.forward, keys.strafe);
  const top = keys.run ? PACE.run : PACE.walk;

  if (want > 0.001) {
    const f = facing(cameraYaw);
    const s = strafe(cameraYaw);
    const dx = (f.x * keys.forward + s.x * keys.strafe) / want;
    const dz = (f.z * keys.forward + s.z * keys.strafe) / want;

    /* The body turns toward where it is going rather than snapping: a figure
       that changes facing in one frame reads as a sprite, not a walker. */
    const target = yawTowards(dx, dz);
    walker.yaw += turnTo(walker.yaw, target) * Math.min(1, PACE.turn * dt);

    walker.speed += (top * Math.min(want, 1) - walker.speed) * Math.min(1, PACE.accel * dt);
    walker.x += dx * walker.speed * dt;
    walker.z += dz * walker.speed * dt;
  } else {
    walker.speed += (0 - walker.speed) * Math.min(1, PACE.accel * dt);
  }

  /* The edge of the field is a wall, not a cliff: walking off it would drop
     the reader through a heightfield that has no data out there. */
  const limit = FIELD.size / 2 - 1.5;
  walker.x = Math.min(Math.max(walker.x, -limit), limit);
  walker.z = Math.min(Math.max(walker.z, -limit), limit);

  if (!Number.isFinite(walker.x) || !Number.isFinite(walker.z) || Math.hypot(walker.x, walker.z) > RESCUE_RADIUS) {
    walker.x = 0;
    walker.z = 0;
    walker.speed = 0;
  }

  walker.y = heightAt(field, walker.x, walker.z);
}
