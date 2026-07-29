/**
 * The switch that turns the harbour's 3D off.
 *
 * `experience-3d-off` was read in three places — HeroRoot before booting the
 * scene, GlRoot on the atelier page, and quality.ts for the tier — and written
 * in none. It was a setting with no way to set it: the only escape from a scene
 * a device could not run was typing ?q=low into the address bar.
 *
 * The class on <html> stays the interface, because that is what the readers
 * already look at. This adds the writer, and remembers the choice.
 */
const KEY = "alice.experience.3d";
const CLASS = "experience-3d-off";

export function is3dOff(): boolean {
  return document.documentElement.classList.contains(CLASS);
}

/** Call once, as early as possible, so the scene never boots to be torn down. */
export function applyStoredExperience(): void {
  try {
    if (window.localStorage.getItem(KEY) === "off") {
      document.documentElement.classList.add(CLASS);
    }
  } catch {
    // Private mode or blocked storage. The default (3D on) is the right one.
  }
}

export function set3dOff(off: boolean): void {
  document.documentElement.classList.toggle(CLASS, off);
  try {
    window.localStorage.setItem(KEY, off ? "off" : "on");
  } catch {
    // Not being able to remember it is survivable; not honouring it is not.
  }
}
