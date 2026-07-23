import { useLayoutEffect, useRef } from "react";
import type { LogEntry } from "../engine/types";

export function LogPanel({ log }: { log: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<{ signature: string; key: number }[]>([]);
  const nextKey = useRef(0);
  const wasNearBottom = useRef(true);
  const signatures = log.map(entry => `${entry.turn}\u0000${entry.seat}\u0000${entry.msgJa}`);
  const previous = previousRef.current;
  let overlap = Math.min(previous.length, signatures.length);
  while (overlap > 0 &&
    previous.slice(previous.length - overlap).some((item, i) => item.signature !== signatures[i])) overlap--;
  const keyed = signatures.map((signature, i) => ({
    signature,
    key: i < overlap ? previous[previous.length - overlap + i]!.key : ++nextKey.current,
  }));
  previousRef.current = keyed;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && wasNearBottom.current) element.scrollTop = element.scrollHeight;
  }, [log]);
  return <aside className="rr-log rr-panel" aria-label="冒険ログ" aria-live="polite" aria-relevant="additions">
    <h3>冒険ログ</h3><div ref={scrollRef} className="rr-log__scroll" onScroll={event => {
      const element = event.currentTarget;
      wasNearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
    }}>{log.map((entry, i) => <p key={keyed[i]!.key}>
      <b className={entry.seat >= 0 ? `rr-seat-color-${entry.seat % 4}` : "rr-seat-color-system"}>{entry.seat >= 0 ? `P${entry.seat + 1}` : "SYSTEM"}</b> {entry.msgJa}
    </p>)}</div>
  </aside>;
}
