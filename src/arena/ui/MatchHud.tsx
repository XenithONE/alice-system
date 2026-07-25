import type { BotSnap, Snapshot } from "../net/protocol";
import type { WeaponAction, WeaponSlot } from "../sim/types";

export interface HudWeapon {
  slot: WeaponSlot;
  name: string;
  action: WeaponAction;
  maxOmega: number;
}

interface MatchHudProps {
  snapshot: Snapshot | null;
  names: readonly string[];
  mySeat: number;
  maxHp: readonly number[];
  matchSec: number;
  weapons: readonly HudWeapon[];
  paused: boolean;
  onPause(): void;
}

function formatTime(elapsed: number, matchSec: number): string {
  const seconds = Math.max(0, Math.ceil(matchSec - elapsed));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function botFor(snapshot: Snapshot | null, seat: number): BotSnap | undefined {
  return snapshot?.bots.find((bot) => bot.seat === seat);
}

export function MatchHud({ snapshot, names, mySeat, maxHp, matchSec, weapons, paused, onPause }: MatchHudProps) {
  const mine = botFor(snapshot, mySeat);
  return (
    <div className="sc-hud">
      <section className="sc-hud__players" aria-label="機体HP">
        {Array.from({ length: 4 }, (_, seat) => {
          const bot = botFor(snapshot, seat);
          const hp = Math.max(0, bot?.hp ?? maxHp[seat] ?? 0);
          const percent = Math.min(100, hp / Math.max(maxHp[seat] ?? hp, 1) * 100);
          return (
            <div className={`sc-hp-card sc-hp-card--${seat}${seat === mySeat ? " is-you" : ""}${bot && !bot.alive ? " is-ko" : ""}`} key={seat}>
              <span>{seat + 1}P {seat === mySeat && "YOU"}</span><strong>{names[seat] ?? `BOT ${seat + 1}`}</strong>
              <div><i style={{ width: `${percent}%` }} /></div><small>HP {Math.ceil(hp)}</small>
            </div>
          );
        })}
      </section>
      <div className="sc-hud__top">
        <span>{snapshot?.phase === "countdown" ? "STARTING" : snapshot?.phase === "over" ? "MATCH OVER" : "残り"}</span>
        <strong>{formatTime(snapshot?.elapsed ?? 0, matchSec)}</strong>
      </div>
      <button className="sc-pause" type="button" onClick={onPause} aria-pressed={paused}>{paused ? "再開" : "一時停止"}</button>
      <section className="sc-weapon-gauges" aria-label="武装状態">
        {(["primary", "secondary"] as const).map((slot) => {
          const def = weapons.find((weapon) => weapon.slot === slot);
          const snap = mine?.w.find((weapon) => weapon.slot === slot);
          const fraction = !def ? 0 : def.action === "triggered" ? snap?.c ?? 0 :
            def.action === "held" ? snap?.f ?? 0 :
            Math.min(1, Math.abs(snap?.o ?? 0) / Math.max(def.maxOmega, 1));
          const value = !def ? "EMPTY" : def.action === "triggered" ? `${Math.round(fraction * 100)}% READY` :
            def.action === "held" ? `${Math.round(fraction * 100)}% FUEL` :
            `${Math.round(Math.abs(snap?.o ?? 0))} rad/s`;
          return (
            <div className={`sc-weapon-gauge${snap?.on ? " is-live" : ""}`} key={slot}>
              <span>{slot === "primary" ? "PRIMARY / SPACE" : "SECONDARY / SHIFT"}</span>
              <strong>{def?.name ?? "未装備"}</strong>
              <div><i style={{ width: `${fraction * 100}%` }} /></div><small>{value}</small>
            </div>
          );
        })}
      </section>
      <section className="sc-controls" aria-label="操作説明">
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>移動</span></div>
        <div><kbd>Space</kbd><span>主兵装</span></div>
        <div><kbd>Shift</kbd><span>副兵装</span></div>
        <div><kbd>R</kbd><span>セルフライト</span></div>
      </section>
      {mine && mine.burn > 0 && <div className="sc-burning">BURNING {mine.burn.toFixed(1)}s</div>}
      {paused && <div className="sc-paused"><strong>PAUSED</strong><span>描画を一時停止しています</span></div>}
    </div>
  );
}
