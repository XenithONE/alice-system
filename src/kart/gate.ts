/**
 * Shared reporting for the NITRO CROWN gates.
 *
 * `expectFail` exists because of the hardest lesson on this site: a check that
 * cannot fail proves nothing. Every gate below states what it measures AND
 * demonstrates, in the same run, that a broken input makes it fail.
 */

declare const process: { exitCode?: number };

export interface Gate {
  check(name: string, ok: boolean, detail: string): void;
  /**
   * Runs `broken` — a deliberately damaged version of the same measurement —
   * and passes only when it comes back false.
   */
  expectFail(name: string, broken: () => boolean, detail: string): void;
  finish(label: string): void;
  readonly failures: readonly string[];
}

export function createGate(): Gate {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
    if (!ok) failures.push(name);
  };
  return {
    failures,
    check,
    expectFail(name, broken, detail) {
      let stillPasses: boolean;
      try {
        stillPasses = broken();
      } catch {
        stillPasses = false;
      }
      check(
        name,
        !stillPasses,
        stillPasses ? `破壊しても通ってしまう: ${detail}` : `破壊で落ちる: ${detail}`,
      );
    },
    finish(label) {
      if (failures.length > 0) {
        console.log(`${label} FAIL — ${failures.join(" / ")}`);
        process.exitCode = 1;
      } else {
        console.log(`${label} PASS`);
      }
    },
  };
}
