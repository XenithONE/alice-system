import type { HostMessage } from "../net/protocol";

type ResultMessage = HostMessage & { t: "result" };

interface ResultScreenProps {
  result: ResultMessage;
  names: readonly string[];
  onRematch(): void;
  onGarage(): void;
}

const REASON = {
  ko: "KNOCK OUT",
  judges: "JUDGES' DECISION",
  draw: "DRAW"
} as const;

const KO_REASON = {
  damage: "車体破壊",
  immobile: "走行不能",
  pit: "ピット落下"
} as const;

export function ResultScreen({ result, names, onRematch, onGarage }: ResultScreenProps) {
  const winnerName = result.winner === null ? "引き分け" : names[result.winner] ?? `BOT ${result.winner + 1}`;
  return (
    <main className="sc-result">
      <div className="sc-result__crown" aria-hidden="true"><i /><i /><i /></div>
      <span className="sc-result__reason">{REASON[result.reason]}</span>
      <h1>{result.winner === null ? winnerName : `${winnerName} の勝利`}</h1>
      {result.kos.length > 0 && (
        <p className="sc-ko-reasons">KO: {result.kos.map((ko) => `${names[ko.seat] ?? `${ko.seat + 1}P`} — ${KO_REASON[ko.reason]}`).join(" / ")}</p>
      )}
      <section className="sc-scoreboard">
        <header><span>JUDGES' SCORE</span><b>DMG</b><b>AGR</b><b>CTL</b><b>TOTAL</b></header>
        {result.scores.map((score) => (
          <div className={score.seat === result.winner ? "is-winner" : ""} key={score.seat}>
            <strong><i>{score.seat + 1}P</i>{names[score.seat] ?? `BOT ${score.seat + 1}`}</strong>
            <span>{score.damage.toFixed(1)}</span>
            <span>{score.aggression.toFixed(1)}</span>
            <span>{score.control.toFixed(1)}</span>
            <b>{score.total.toFixed(1)}</b>
          </div>
        ))}
      </section>
      <div className="sc-result__actions">
        <button className="sc-button sc-button--primary" type="button" onClick={onRematch}>もう一度</button>
        <button className="sc-button" type="button" onClick={onGarage}>ガレージへ</button>
      </div>
    </main>
  );
}
