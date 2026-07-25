import { MATCH_SEC } from "../sim/balance";
import type { BotSnap, Snapshot } from "../net/protocol";

interface MatchHudProps {
  snapshot: Snapshot | null;
  names: readonly string[];
  mySeat: number;
  maxHp: readonly number[];
  paused: boolean;
  onPause(): void;
}

function formatTime(elapsed: number): string {
  const seconds = Math.max(0, Math.ceil(MATCH_SEC - elapsed));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function botFor(snapshot: Snapshot | null, seat: number): BotSnap | undefined {
  return snapshot?.bots.find((bot) => bot.seat === seat);
}

export function MatchHud({ snapshot, names, mySeat, maxHp, paused, onPause }: MatchHudProps) {
  const mine = botFor(snapshot, mySeat);
  const omega = Math.abs(mine?.wo ?? 0);
  const rpmPercent = Math.min(100, omega / 3);
  return (
    <div className="sc-hud">
      <section className="sc-hud__players" aria-label="機体HP">
        {Array.from({ length: 4 }, (_, seat) => {
          const bot = botFor(snapshot, seat);
          const hp = Math.max(0, bot?.hp ?? maxHp[seat] ?? 0);
          const percent = Math.min(100, hp / Math.max(maxHp[seat] ?? hp, 1) * 100);
          return (
            <div className={`sc-hp-card sc-hp-card--${seat}${seat === mySeat ? " is-you" : ""}${bot && !bot.alive ? " is-ko" : ""}`} key={seat}>
              <span>{seat + 1}P {seat === mySeat && "YOU"}</span>
              <strong>{names[seat] ?? `BOT ${seat + 1}`}</strong>
              <div><i style={{ width: `${percent}%` }} /></div>
              <small>HP {Math.ceil(hp)}</small>
            </div>
          );
        })}
      </section>
      <div className="sc-hud__top">
        <span>{snapshot?.phase === "countdown" ? "STARTING" : snapshot?.phase === "over" ? "MATCH OVER" : "残り"}</span>
        <strong>{formatTime(snapshot?.elapsed ?? 0)}</strong>
      </div>
      <button className="sc-pause" type="button" onClick={onPause} aria-pressed={paused}>{paused ? "再開" : "一時停止"}</button>
      <section className="sc-rpm" aria-label={`武器回転数 ${Math.round(omega)} ラジアン毎秒`}>
        <span>武器回転数</span>
        <div><i style={{ width: `${rpmPercent}%` }} /></div>
        <strong>{Math.round(omega)} <small>rad/s</small></strong>
      </section>
      <section className="sc-controls" aria-label="操作説明">
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>移動</span></div>
        <div><kbd>Space</kbd><span>武器</span></div>
        <div><kbd>R</kbd><span>セルフライト</span></div>
      </section>
      {paused && <div className="sc-paused"><strong>PAUSED</strong><span>描画を一時停止しています</span></div>}
    </div>
  );
}
