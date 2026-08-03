import { useSyncExternalStore } from "react";

/*
 * The single source of truth for whether this page is allowed to move.
 *
 * The truth lives on <html> as the `motion-on` class, planted before first
 * paint by the boot script in index.html (and harbor.html — theme.css is a
 * shared chunk, so both documents must agree on what the class means).
 * Everything that moves — CSS animation, scroll timelines, the fluid layer,
 * the cursor — keys off that one class and nothing else. JS must never read
 * `prefers-reduced-motion` directly: two readers of two sources is how the
 * toggle and the OS end up disagreeing mid-session.
 *
 * Resolution order, boot and toggle alike:
 *   stored "on"  -> moving, even where the OS asks for reduced motion.
 *                   An explicit request from the reader outranks the OS
 *                   default — that is the accessibility-correct direction
 *                   for an override the reader operates themselves.
 *   stored "off" -> still, everywhere.
 *   nothing      -> follow the OS, and keep following it live.
 */

const KEY = "alice_motion";
const CLASS = "motion-on";
const EVENT = "alice:motion-change";
const QUERY = "(prefers-reduced-motion: no-preference)";

export type MotionChoice = "on" | "off" | "auto";

export function motionOn(): boolean {
  return document.documentElement.classList.contains(CLASS);
}

export function getMotionChoice(): MotionChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "on" || v === "off") return v;
  } catch {
    /* private mode — boot already fell back to the OS preference */
  }
  return "auto";
}

function osAllows(): boolean {
  return window.matchMedia(QUERY).matches;
}

function resolve(choice: MotionChoice): boolean {
  return choice === "on" || (choice === "auto" && osAllows());
}

function setClass(on: boolean): void {
  document.documentElement.classList.toggle(CLASS, on);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/*
 * The runtime's only writer. The boot script is the only other one, and it
 * runs once before anything here is loaded.
 */
export function applyMotion(choice: MotionChoice): void {
  try {
    if (choice === "auto") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    /* private mode — the choice still applies for this session */
  }
  setClass(resolve(choice));
}

/*
 * Live OS follow, gated to "auto": once the reader has chosen explicitly,
 * flipping the OS switch must not fight their choice.
 */
let watchingOs = false;
export function watchOsPreference(): void {
  if (watchingOs) return;
  watchingOs = true;
  window.matchMedia(QUERY).addEventListener("change", () => {
    if (getMotionChoice() === "auto") setClass(osAllows());
  });
}

export function watchMotion(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/* React view of the same fact. */
export function useMotion(): boolean {
  return useSyncExternalStore(watchMotion, motionOn);
}
