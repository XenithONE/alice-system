import type { CardDef } from "../engine/types";
import { sfx } from "../sfx";

function Studs({ n, active = n }: { n: number; active?: number }) {
  const shown = Math.min(5, Math.max(0, n));
  return <><span className="rr-studs" aria-hidden="true">{Array.from({ length: shown }, (_, i) => <i className={i < active ? "is-active" : ""} key={i} />)}</span>
    {n > 5 && <small className="rr-studs-more">+{n - 5}</small>}</>;
}

export function HandBar({ hand, energy, moves, canPlay, onPlay, onEndTurn, myTurn, inCombat, onCombatEnd, onFlee }: {
  hand: CardDef[]; energy: number; moves: number; canPlay(i: number): boolean; onPlay(i: number): void;
  onEndTurn(): void; myTurn: boolean; inCombat: boolean; onCombatEnd(): void; onFlee(): void;
}) {
  return <section className="rr-handbar" aria-label="手札">
    <div className="rr-counters">
      <span>エナジー <Studs n={Math.max(3, energy)} active={energy} /></span>
      <span>移動 <Studs n={Math.max(3, moves)} active={moves} /></span>
    </div>
    <div className="rr-hand">{hand.map((card, i) => <button type="button"
      className={`rr-card rr-card--${card.kind}`}
      key={`${card.id}-${i}`}
      disabled={!canPlay(i)}
      onClick={() => { sfx.play("ui-click"); onPlay(i); }}>
      <span className="rr-card__studs" />
      <span className="rr-card__cost" aria-label={`コスト ${card.energy}`}>{card.energy}</span>
      <span className="rr-card__en">{card.name}</span>
      <strong>{card.nameJa}</strong>
      <span className="rr-card__text">{card.textJa}</span>
    </button>)}</div>
    <div className="rr-turn-actions">{inCombat ? <>
      <button type="button" className="rr-button rr-button--blue" disabled={!myTurn}
        onClick={() => { sfx.play("ui-click"); onCombatEnd(); }}>敵の行動へ</button>
      <button type="button" className="rr-button" disabled={!myTurn}
        onClick={() => { sfx.play("ui-click"); onFlee(); }}>逃げる</button>
    </> : <button type="button" className="rr-button rr-button--red" disabled={!myTurn}
      onClick={() => { sfx.play("ui-click"); onEndTurn(); }}>ターン終了</button>}</div>
  </section>;
}
