import type { ClassId } from "../engine/types";
import type { LobbyView } from "../net/protocol";
import { sfx } from "../sfx";

const CLASSES: { id: ClassId; ja: string }[] = [
  { id: "knight", ja: "騎士" }, { id: "rogue", ja: "盗賊" },
  { id: "mage", ja: "魔術師" }, { id: "cleric", ja: "僧侶" },
];

export function Lobby({ lobby, you, isHost, room, onCls, onReady, onStart, canStart }: {
  lobby: LobbyView; you: number; isHost: boolean; room: string;
  onCls(cls: ClassId): void; onReady(r: boolean): void; onStart(): void; canStart: boolean;
}) {
  const me = lobby.seats.find(s => s.seat === you);
  const copy = () => {
    sfx.play("ui-click");
    void navigator.clipboard?.writeText(room);
  };
  return <section className="rr-lobby rr-panel" aria-labelledby="rr-lobby-title">
    <header className="rr-lobby__head"><div><span className="rr-kicker">ルームコード</span><h2 id="rr-lobby-title">{room}</h2></div>
      <button className="rr-chip" type="button" onClick={copy}>コピー</button></header>
    <div className="rr-seats">{lobby.seats.map(seat => <article className={`rr-seat ${seat.seat === you ? "is-you" : ""}`} key={seat.seat}>
      <div className="rr-seat__name"><strong>{seat.name}</strong>{seat.bot && <span className="rr-badge">BOT</span>}</div>
      <div className="rr-class-picker" aria-label={`${seat.name}のクラス`}>
        {CLASSES.map(cls => <button type="button" key={cls.id} disabled={seat.seat !== you}
          className={`rr-class-chip rr-class-${cls.id} ${seat.cls === cls.id ? "is-active" : ""}`}
          aria-pressed={seat.cls === cls.id}
          onClick={() => { sfx.play("ui-click"); onCls(cls.id); }}>
          <i className={`rr-class-portrait rr-class-portrait--${cls.id}`} aria-hidden="true" />
          {cls.ja}
        </button>)}
      </div>
      {seat.seat === lobby.hostSeat
        ? <span className="rr-ready rr-host-badge">HOST</span>
        : <span className={`rr-ready ${seat.ready ? "is-ready" : ""}`}>{seat.ready ? "✓ 準備完了" : "準備中"}</span>}
    </article>)}</div>
    <footer className="rr-lobby__foot">
      <p>{isHost ? "全員の準備ができたら冒険を開始できます。" : "クラスを選び、準備完了にしてください。"}</p>
      {me && !me.bot && me.seat !== lobby.hostSeat && <button className="rr-button rr-button--blue" type="button"
        onClick={() => { sfx.play("ui-click"); onReady(!me.ready); }}>{me.ready ? "準備を解除" : "準備完了"}</button>}
      {isHost && <button className="rr-button rr-button--red" type="button" disabled={!canStart}
        onClick={() => { sfx.play("ui-confirm"); onStart(); }}>冒険を開始</button>}
    </footer>
  </section>;
}
