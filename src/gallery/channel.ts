/**
 * How the corridor talks to the page.
 *
 * Two custom events on `window`, and deliberately not a callback threaded
 * through GpuRoot. GpuRoot is shared with the next WebGPU page and has no
 * business knowing that this one has an active exhibit; a page-specific
 * callback in its props would make it the union of every page that ever uses
 * it. Events also survive the world being torn down and rebuilt — the
 * listener is React's, the dispatcher is the world's, and neither holds a
 * reference to the other.
 *
 * The names live here rather than being typed twice, because a typo in an
 * event name is a feature that silently does nothing.
 */

/** The frame the reader is standing in front of. detail: index into EXHIBITS. */
export const ACTIVE_EVENT = "alice:gallery-active";

/** The frame under the pointer, or -1. detail: index into EXHIBITS. */
export const HOVER_EVENT = "alice:gallery-hover";

export function emitIndex(name: string, index: number): void {
  window.dispatchEvent(new CustomEvent(name, { detail: index }));
}

export function watchIndex(name: string, cb: (index: number) => void): () => void {
  const handler = (event: Event): void => cb((event as CustomEvent<number>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
