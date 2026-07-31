/**
 * Keyboard, gamepad and touch, collapsed into one `KartInput` per frame.
 *
 * The sim only ever sees the collapsed value, so a player can hold the
 * accelerator on a pad and steer on the keyboard and nothing downstream has to
 * know. Steering is eased here rather than in the sim because a keyboard is a
 * digital stick and a pad is not — the sim smooths what it is given, and
 * double-smoothing an analogue stick makes it feel like syrup.
 */

import { NEUTRAL_INPUT, type KartInput } from "./sim/types";

export interface TouchState {
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  item: boolean;
}

export interface InputSource {
  read(dt: number): KartInput;
  /** Live touch state the on-screen controls write into. */
  readonly touch: TouchState;
  readonly usingGamepad: boolean;
  dispose(): void;
}

const KEY_ACCEL = new Set(["ArrowUp", "KeyW"]);
const KEY_BRAKE = new Set(["ArrowDown", "KeyS"]);
const KEY_LEFT = new Set(["ArrowLeft", "KeyA"]);
const KEY_RIGHT = new Set(["ArrowRight", "KeyD"]);
const KEY_DRIFT = new Set(["Space", "ShiftLeft", "ShiftRight"]);
const KEY_ITEM = new Set(["KeyZ", "ControlLeft", "Enter", "KeyL"]);
const KEY_LOOK = new Set(["KeyQ"]);

const SWALLOWED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

/** How fast a keyboard steer ramps to full lock, per second. */
const KEY_STEER_RATE = 4.2;
const KEY_STEER_RETURN = 7.5;

export function createInputSource(target: HTMLElement | Window = window): InputSource {
  const held = new Set<string>();
  let steer = 0;
  let usingGamepad = false;

  const touch: TouchState = {
    steer: 0,
    throttle: false,
    brake: false,
    drift: false,
    item: false,
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    held.add(event.code);
    if (SWALLOWED.has(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
    if (SWALLOWED.has(event.code)) event.preventDefault();
  };
  const onBlur = (): void => held.clear();

  const listener = target as Window;
  listener.addEventListener("keydown", onKeyDown as EventListener);
  listener.addEventListener("keyup", onKeyUp as EventListener);
  window.addEventListener("blur", onBlur);

  function anyHeld(codes: Set<string>): boolean {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  function readGamepad(): KartInput | null {
    if (typeof navigator.getGamepads !== "function") return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const axis = pad.axes[0] ?? 0;
      const rightTrigger = pad.buttons[7]?.value ?? 0;
      const leftTrigger = pad.buttons[6]?.value ?? 0;
      const face = pad.buttons[0]?.pressed ?? false;
      const drift =
        (pad.buttons[1]?.pressed ?? false) ||
        (pad.buttons[4]?.pressed ?? false) ||
        (pad.buttons[5]?.pressed ?? false);
      const item = pad.buttons[2]?.pressed ?? false;
      const look = pad.buttons[3]?.pressed ?? false;
      const throttle = Math.max(rightTrigger, face ? 1 : 0);
      const active =
        Math.abs(axis) > 0.18 ||
        throttle > 0.05 ||
        leftTrigger > 0.05 ||
        drift ||
        item;
      if (!active) continue;
      return {
        throttle,
        brake: leftTrigger,
        steer: Math.abs(axis) < 0.12 ? 0 : axis,
        drift,
        item,
        lookBack: look,
      };
    }
    return null;
  }

  return {
    touch,
    get usingGamepad() {
      return usingGamepad;
    },
    read(dt) {
      const pad = readGamepad();
      if (pad) {
        usingGamepad = true;
        steer = pad.steer;
        return pad;
      }
      usingGamepad = false;

      const left = anyHeld(KEY_LEFT) || touch.steer < -0.2;
      const right = anyHeld(KEY_RIGHT) || touch.steer > 0.2;
      const analogue =
        Math.abs(touch.steer) > 0.2 && !anyHeld(KEY_LEFT) && !anyHeld(KEY_RIGHT)
          ? touch.steer
          : null;

      if (analogue !== null) {
        steer = analogue;
      } else if (left === right) {
        const decay = KEY_STEER_RETURN * dt;
        steer = steer > 0 ? Math.max(0, steer - decay) : Math.min(0, steer + decay);
      } else {
        const rate = KEY_STEER_RATE * dt;
        steer = right
          ? Math.min(1, steer + rate)
          : Math.max(-1, steer - rate);
      }

      return {
        throttle: anyHeld(KEY_ACCEL) || touch.throttle ? 1 : 0,
        brake: anyHeld(KEY_BRAKE) || touch.brake ? 1 : 0,
        steer,
        drift: anyHeld(KEY_DRIFT) || touch.drift,
        item: anyHeld(KEY_ITEM) || touch.item,
        lookBack: anyHeld(KEY_LOOK),
      };
    },
    dispose() {
      listener.removeEventListener("keydown", onKeyDown as EventListener);
      listener.removeEventListener("keyup", onKeyUp as EventListener);
      window.removeEventListener("blur", onBlur);
      held.clear();
    },
  };
}

export const IDLE_INPUT: KartInput = NEUTRAL_INPUT;
