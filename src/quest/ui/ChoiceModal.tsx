import { useEffect, useRef } from "react";
import type { CardDef, EventDef, PendingChoice } from "../engine/types";

export function useModalFocus() {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const actionable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )];
    actionable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = actionable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return dialogRef;
}

export function ChoiceModal({ choice, event, cards, gold, onChoose }: {
  choice: PendingChoice; event?: EventDef; cards: Record<string, CardDef>; gold: number; onChoose(idx: number): void;
}) {
  const isEvent = choice.t === "event";
  const dialogRef = useModalFocus();
  return <div className="rr-modal-backdrop" role="presentation"><section ref={dialogRef} className="rr-modal rr-panel" role="dialog" aria-modal="true" aria-labelledby="rr-choice-title">
    <span className="rr-kicker">{choice.t === "levelup" ? "レベルアップ" : choice.t === "loot" ? "戦利品" : "イベント"}</span>
    <h2 id="rr-choice-title">{isEvent ? event?.nameJa ?? "運命の選択" : "ひとつ選んでください"}</h2>
    {isEvent ? <>
      <p>{event?.textJa}</p><div className="rr-choice-list">{event?.choices.map((option, i) => {
        const disabled = (option.goldCost ?? 0) > gold;
        return <button className="rr-button" type="button" key={i} disabled={disabled} onClick={() => onChoose(i)}>
          {option.labelJa}{option.goldCost != null && `（${option.goldCost} G）`}
        </button>;
      })}</div>
    </> : <div className="rr-choice-cards">{choice.options.map((id, i) => {
      const card = cards[id];
      return <button className="rr-card rr-card--choice" type="button" key={`${id}-${i}`} onClick={() => onChoose(i)}>
        <span className="rr-card__studs" /><span className="rr-card__en">{card?.name ?? id}</span><strong>{card?.nameJa ?? id}</strong><span className="rr-card__text">{card?.textJa}</span>
      </button>;
    })}</div>}
    {choice.t === "loot" && <button className="rr-button rr-choice-skip" type="button" onClick={() => onChoose(choice.options.length)}>受け取らない</button>}
  </section></div>;
}
