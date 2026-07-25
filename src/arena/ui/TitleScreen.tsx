import { useState } from "react";

interface TitleScreenProps {
  initialRoom: string;
  onSolo(): void;
  onHost(): void;
  onJoin(room: string): void;
}

function cleanRoom(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

export function TitleScreen({ initialRoom, onSolo, onHost, onJoin }: TitleScreenProps) {
  const [joining, setJoining] = useState(initialRoom.length > 0);
  const [room, setRoom] = useState(cleanRoom(initialRoom));
  return (
    <main className="sc-title">
      <div className="sc-title__steel" aria-hidden="true" />
      <section className="sc-title__content">
        <a className="sc-backlink" href="index.html#games">← AlicE sYsTeM</a>
        <div className="sc-title__mark" aria-hidden="true"><i /><i /><i /></div>
        <h1>SCRAP<br /><span>CROWN</span></h1>
        <p className="sc-title__lead">ブロックを組め。鉄屑になるまで戦え。</p>
        <ol className="sc-howto" aria-label="遊び方">
          <li><b>01</b><span>120kg以内で機体を組み立てる</span></li>
          <li><b>02</b><span>武器を回し、金網アリーナで激突</span></li>
          <li><b>03</b><span>KOかジャッジ判定で王冠を奪う</span></li>
        </ol>
        <div className="sc-title__actions">
          <button className="sc-button sc-button--primary" type="button" onClick={onSolo}>ソロで試す</button>
          <button className="sc-button" type="button" onClick={onHost}>部屋を作る</button>
          <button className="sc-button" type="button" onClick={() => setJoining((value) => !value)}>部屋に入る</button>
        </div>
        {joining && (
          <form className="sc-join" onSubmit={(event) => { event.preventDefault(); if (room.length === 6) onJoin(room); }}>
            <label htmlFor="sc-room-input">ROOM CODE</label>
            <div>
              <input id="sc-room-input" value={room} onChange={(event) => setRoom(cleanRoom(event.target.value))}
                placeholder="6文字" autoComplete="off" autoFocus />
              <button className="sc-button sc-button--small" type="submit" disabled={room.length !== 6}>接続</button>
            </div>
          </form>
        )}
      </section>
      <aside className="sc-title__machine" aria-label="ゲームイメージ">
        <div className="sc-machine__blade" />
        <div className="sc-machine__body"><i /><i /><i /><i /></div>
        <div className="sc-machine__track sc-machine__track--left" />
        <div className="sc-machine__track sc-machine__track--right" />
      </aside>
    </main>
  );
}
