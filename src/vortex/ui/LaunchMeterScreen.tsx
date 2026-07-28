import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  LAUNCH_METER_VERSION,
  launchPositionAt,
  stopLaunchMeter,
  type LaunchMeterSpec,
  type LaunchStopResult,
} from "../launch";

export interface LaunchSeatView {
  readonly seat: number;
  readonly name: string;
  readonly stopped: boolean;
  readonly power: number | null;
}

export interface LaunchMeterScreenProps {
  readonly spec: LaunchMeterSpec;
  /** Host sampled remaining time when this view state was received. */
  readonly remainingMs: number;
  readonly seat: number;
  readonly seats: readonly LaunchSeatView[];
  readonly wave?: number;
  readonly title?: string;
  readonly onStop: (result: LaunchStopResult) => void;
  readonly onExit?: () => void;
}

const GRADE_LABEL: Record<LaunchStopResult["grade"], string> = {
  miss: "WOBBLE",
  good: "GOOD",
  great: "GREAT",
  perfect: "PERFECT",
  timeout: "AUTO LAUNCH",
};

function runningState(spec: LaunchMeterSpec, elapsedMs: number) {
  return {
    v: LAUNCH_METER_VERSION,
    spec,
    elapsedMs,
    position: launchPositionAt(spec, elapsedMs),
    status: "running" as const,
    result: null,
  };
}

export function LaunchMeterScreen({
  spec,
  remainingMs,
  seat,
  seats,
  wave,
  title = "LAUNCH SYNCHRONIZER",
  onStop,
  onExit,
}: LaunchMeterScreenProps) {
  const initialElapsed = useMemo(
    () => Math.max(0, spec.durationMs - Math.max(0, remainingMs)),
    [remainingMs, spec.durationMs],
  );
  const startedAt = useRef(performance.now());
  const submitted = useRef(false);
  const [elapsedMs, setElapsedMs] = useState(initialElapsed);
  const [result, setResult] = useState<LaunchStopResult | null>(null);
  const position = result?.position ?? launchPositionAt(spec, elapsedMs);
  const me = seats.find((candidate) => candidate.seat === seat);

  useEffect(() => {
    startedAt.current = performance.now();
    submitted.current = false;
    setElapsedMs(initialElapsed);
    setResult(null);
  }, [initialElapsed, spec.seed]);

  const stop = useCallback((atMs?: number) => {
    if (submitted.current || me?.stopped) return;
    const sampledElapsed = Math.min(
      spec.durationMs,
      Math.max(
        0,
        atMs ??
          initialElapsed + (performance.now() - startedAt.current),
      ),
    );
    const next = stopLaunchMeter(
      runningState(spec, sampledElapsed),
      sampledElapsed,
    ).result;
    if (!next) return;
    submitted.current = true;
    setElapsedMs(next.stoppedAtMs);
    setResult(next);
    onStop(next);
  }, [initialElapsed, me?.stopped, onStop, spec]);

  useEffect(() => {
    let frame = 0;
    const update = (now: number) => {
      if (!submitted.current && !me?.stopped) {
        const nextElapsed = Math.min(
          spec.durationMs,
          initialElapsed + (now - startedAt.current),
        );
        setElapsedMs(nextElapsed);
        if (nextElapsed >= spec.durationMs) stop(spec.durationMs);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [initialElapsed, me?.stopped, spec.durationMs, stop]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.code === "Space" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  const shownPower = result?.power ?? me?.power ?? null;
  const resolved = Boolean(result || me?.stopped);
  const remaining = Math.max(0, spec.durationMs - elapsedMs);

  return (
    <main className="vc-launch" data-testid="vortex-launch-meter">
      <div className="vc-launch__scan" aria-hidden="true" />
      <header className="vc-launch__header">
        <div>
          <div className="vc-kicker">
            {wave ? `CO-OP ENDLESS / WAVE ${wave}` : "VORTEX START SEQUENCE"}
          </div>
          <h1>{title}</h1>
        </div>
        {onExit && (
          <button className="vc-btn vc-btn--ghost" onClick={onExit}>
            EXIT
          </button>
        )}
      </header>

      <section className="vc-launch__panel">
        <div className="vc-launch__dial">
          <div className="vc-launch__readout">
            <span>ROTATION FEED</span>
            <strong>
              {resolved
                ? `${Math.round((shownPower ?? 0) * 100)}%`
                : `${(remaining / 1000).toFixed(2)} SEC`}
            </strong>
          </div>
          <div
            className="vc-launch__track"
            style={{
              "--launch-position": `${position * 100}%`,
              "--target-start": `${spec.targetZone.start * 100}%`,
              "--target-width": `${(spec.targetZone.end - spec.targetZone.start) * 100}%`,
            } as CSSProperties}
            aria-label="発射パワーメーター"
          >
            <div className="vc-launch__ticks" />
            <div className="vc-launch__target">
              <span>PERFECT</span>
            </div>
            <div className="vc-launch__needle" />
          </div>
          <button
            className={`vc-launch__stop${resolved ? " is-resolved" : ""}`}
            disabled={resolved}
            onClick={() => stop()}
            data-testid="launch-stop"
          >
            <small>{resolved ? "POWER LOCKED" : "SPACE / TAP"}</small>
            <strong>
              {result
                ? GRADE_LABEL[result.grade]
                : me?.stopped
                  ? "SYNCED"
                  : "STOP"}
            </strong>
          </button>
          <p>
            中央の発光帯で止めるほど、初期回転と突入速度が上がります。
            時間切れでも自動発射されます。
          </p>
        </div>

        <aside className="vc-launch__team">
          <div className="vc-kicker">SQUAD LAUNCH STATUS</div>
          {seats.map((candidate) => (
            <div
              className={`vc-launch__seat${candidate.stopped ? " is-ready" : ""}`}
              key={candidate.seat}
            >
              <span>P{candidate.seat + 1}</span>
              <strong>{candidate.name}</strong>
              <b>
                {candidate.stopped
                  ? `${Math.round((candidate.power ?? 0) * 100)}%`
                  : candidate.seat === seat
                    ? "YOUR TURN"
                    : "SPINNING"}
              </b>
            </div>
          ))}
        </aside>
      </section>
    </main>
  );
}
