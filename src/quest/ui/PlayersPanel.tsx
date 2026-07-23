import type { ClassDef, ClassId } from "../engine/types";
import type { RivalView } from "../net/protocol";

export function PlayersPanel({ players, you, current, classes }: {
  players: RivalView[]; you: number; current: number; classes: Record<ClassId, ClassDef>;
}) {
  return <aside className="rr-players rr-panel" aria-label="プレイヤー">{players.map(player => {
    const hp = Math.max(0, player.hp / player.maxHp * 100);
    return <div className="rr-player" key={player.seat}>
      <i className="rr-player__dot" style={{ background: classes[player.cls].color }} /><div className="rr-player__main">
        <div><strong>{player.name}</strong><span>Lv.{player.level}</span>{player.seat === you && <b>YOU</b>}{player.seat === current && <b>TURN</b>}</div>
        <div className="rr-hp"><i style={{ width: `${hp}%` }} /></div>
        <small>HP {player.hp}/{player.maxHp} ・ {player.gold} G ・ 山{player.deckN}/手{player.handN}</small>
      </div><span className="rr-relics" aria-label={`レリック${player.relics.length}個`}>{[0, 1, 2].map(n => <i className={player.relics.includes(n) ? "is-active" : ""} key={n} />)}</span>
    </div>;
  })}</aside>;
}
