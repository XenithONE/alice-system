/**
 * Keyboard, gamepad and touch, collapsed into one `KartInput` per frame.
 *
 * The sim only ever sees the collapsed value, so a player can hold the
 * accelerator on a pad and steer on the keyboard and nothing downstream has to
 * know.
 *
 * Steering is NOT eased here. It used to be, and the header used to explain
 * that the sim would double-smooth an analogue stick — which was true of the
 * stick and false of everything else: the keyboard ramped over 238 ms here and
 * then the sim lerped it again, so a key press took a third of a second to
 * reach full lock. Worse, the ramp lived in a module variable that only existed
 * on whichever machine was pressing keys, so a host and a guest smoothed the
 * same driver differently. One easing, in the sim, where both of them run it.
 */

import { NEUTRAL_INPUT, type KartInput } from "./sim/types";

export interface TouchState {
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  gimmick: boolean;
  skill: boolean;
  item0: boolean;
  item1: boolean;
  item2: boolean;
}

export interface InputSource {
  read(dt: number): KartInput;
  /** Live touch state the on-screen controls write into. */
  readonly touch: TouchState;
  readonly usingGamepad: boolean;
  dispose(): void;
}

/**
 * Every key the game reads, in one table.
 *
 * Written as data rather than a scatter of `Set`s because the bindings are now
 * a thing a player might reasonably want to change: A/S/D are the item slots,
 * which means WASD steering is gone and left-handers have only the arrows.
 * A rebinding screen is not built yet; this is the shape it will read.
 */
export interface KeyBindings {
  readonly throttle: readonly string[];
  readonly brake: readonly string[];
  readonly steerLeft: readonly string[];
  readonly steerRight: readonly string[];
  readonly drift: readonly string[];
  readonly gimmick: readonly string[];
  readonly skill: readonly string[];
  readonly item0: readonly string[];
  readonly item1: readonly string[];
  readonly item2: readonly string[];
  readonly lookBack: readonly string[];
}

export const DEFAULT_BINDINGS: KeyBindings = {
  throttle: ["ArrowUp"],
  brake: ["ArrowDown"],
  steerLeft: ["ArrowLeft"],
  steerRight: ["ArrowRight"],
  drift: ["Space"],
  gimmick: ["ShiftLeft", "ShiftRight"],
  // KeyW is a courtesy alias: the finger that used to accelerate finds it.
  skill: ["KeyE", "KeyW"],
  item0: ["KeyA"],
  item1: ["KeyS"],
  item2: ["KeyD"],
  lookBack: ["KeyQ"],
};

/**
 * Only the keys whose default action would fight the game. Shift is NOT here —
 * swallowing it breaks Shift+Tab and confuses IMEs and screen readers — and
 * the letter keys have no default action to suppress.
 */
const SWALLOWED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

/** Pad stick deadzone. Rescaled past it so the axis stays continuous. */
const PAD_DEADZONE = 0.12;

function applyDeadzone(axis: number): number {
  const magnitude = Math.abs(axis);
  if (magnitude <= PAD_DEADZONE) return 0;
  return (Math.sign(axis) * (magnitude - PAD_DEADZONE)) / (1 - PAD_DEADZONE);
}

/**
 * True when a keystroke belongs to the page rather than the race: the player
 * is typing a room code, or holding a browser shortcut. Without this, binding
 * the item slots to A/S/D means Ctrl+S throws a banana and typing "asd" into
 * the join field empties the inventory.
 */
function keystrokeIsOurs(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  const focused = document.activeElement;
  if (!focused) return true;
  const tag = focused.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return !(focused as HTMLElement).isContentEditable;
}

export function createInputSource(
  target: HTMLElement | Window = window,
  bindings: KeyBindings = DEFAULT_BINDINGS,
): InputSource {
  const held = new Set<string>();
  let usingGamepad = false;

  const touch: TouchState = {
    steer: 0,
    throttle: false,
    brake: false,
    drift: false,
    gimmick: false,
    skill: false,
    item0: false,
    item1: false,
    item2: false,
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (!keystrokeIsOurs(event)) {
      // Drop anything already down: a modifier pressed mid-hold must not leave
      // the key latched once the shortcut steals the keyup.
      held.delete(event.code);
      return;
    }
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

  function anyHeld(codes: readonly string[]): boolean {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  function readGamepad(): KartInput | null {
    if (typeof navigator.getGamepads !== "function") return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const down = (index: number): boolean =>
        pad.buttons[index]?.pressed ?? false;
      // Face buttons sit where a kart game puts them: accelerate on the
      // trigger, drift under the thumb, the three item slots on X/LB/RB.
      const stick = applyDeadzone(pad.axes[0] ?? 0);
      const dpad = (down(15) ? 1 : 0) - (down(14) ? 1 : 0);
      const steer = stick !== 0 ? stick : dpad;
      const throttle = Math.max(pad.buttons[7]?.value ?? 0, down(0) ? 1 : 0);
      const brake = Math.max(pad.buttons[6]?.value ?? 0, down(1) ? 1 : 0);
      const input: KartInput = {
        throttle,
        brake,
        steer,
        drift: down(0),
        gimmick: down(13),
        skill: down(12),
        item0: down(2),
        item1: down(4),
        item2: down(5),
        lookBack: down(3),
      };
      const active =
        steer !== 0 ||
        throttle > 0.05 ||
        brake > 0.05 ||
        input.drift ||
        input.gimmick ||
        input.skill ||
        input.item0 ||
        input.item1 ||
        input.item2 ||
        input.lookBack;
      if (!active) continue;
      return input;
    }
    return null;
  }

  return {
    touch,
    get usingGamepad() {
      return usingGamepad;
    },
    read() {
      const pad = readGamepad();
      if (pad) {
        usingGamepad = true;
        return pad;
      }
      usingGamepad = false;

      const left = anyHeld(bindings.steerLeft);
      const right = anyHeld(bindings.steerRight);
      // A touch drag is already analogue; keys are ±1 and the sim eases them.
      const steer =
        Math.abs(touch.steer) > 0.2 && !left && !right
          ? touch.steer
          : (right ? 1 : 0) - (left ? 1 : 0);

      return {
        throttle: anyHeld(bindings.throttle) || touch.throttle ? 1 : 0,
        brake: anyHeld(bindings.brake) || touch.brake ? 1 : 0,
        steer,
        drift: anyHeld(bindings.drift) || touch.drift,
        gimmick: anyHeld(bindings.gimmick) || touch.gimmick,
        skill: anyHeld(bindings.skill) || touch.skill,
        item0: anyHeld(bindings.item0) || touch.item0,
        item1: anyHeld(bindings.item1) || touch.item1,
        item2: anyHeld(bindings.item2) || touch.item2,
        lookBack: anyHeld(bindings.lookBack),
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
