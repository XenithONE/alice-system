/**
 * Frame timing, measured in a way that can actually detect a stutter.
 *
 * The existing hero scenes keep `fpsN` and `fpsAcc` and report N/sum(dt).
 * That is the harmonic mean of 1/dt, and it hides exactly what a reader
 * notices: eighty-nine frames at 16 ms plus one at 300 ms reports 58 fps, and
 * 58 fps is a pass. The one frame that made the page lurch is averaged into
 * nothing.
 *
 * Percentiles over a ring buffer report the same run as p50 16 ms, p95 16 ms,
 * worst 300 ms — three numbers, one of which is the complaint.
 */

export interface FrameStats {
  readonly frames: number;
  /** Milliseconds. */
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
}

export class FrameClock {
  private readonly ring: Float32Array;
  private index = 0;
  private filled = 0;
  private scratch: Float32Array;

  constructor(private readonly window = 120) {
    this.ring = new Float32Array(window);
    this.scratch = new Float32Array(window);
  }

  push(deltaMs: number): void {
    /* A tab that was hidden comes back with one enormous delta that is not a
       stutter, it is absence. Anything past a third of a second is discarded
       rather than allowed to define `worst` for the next 120 frames. */
    if (!(deltaMs > 0) || deltaMs > 333) return;
    this.ring[this.index] = deltaMs;
    this.index = (this.index + 1) % this.window;
    this.filled = Math.min(this.filled + 1, this.window);
  }

  stats(): FrameStats {
    if (this.filled === 0) return { frames: 0, p50: 0, p95: 0, worst: 0 };
    const n = this.filled;
    if (this.scratch.length !== n) this.scratch = new Float32Array(n);
    for (let i = 0; i < n; i++) this.scratch[i] = this.ring[i]!;
    this.scratch.sort();
    const at = (q: number): number => this.scratch[Math.min(n - 1, Math.floor(q * n))]!;
    return { frames: n, p50: at(0.5), p95: at(0.95), worst: this.scratch[n - 1]! };
  }

  reset(): void {
    this.index = 0;
    this.filled = 0;
  }
}
