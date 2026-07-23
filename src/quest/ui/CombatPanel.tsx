import type { CombatState, MonsterDef } from "../engine/types";
import type { RivalView } from "../net/protocol";

export function CombatPanel({ combat, monster, player }: { combat: CombatState; monster: MonsterDef; player: RivalView }) {
  const hpSegments = 10, hpActive = Math.ceil(Math.max(0, combat.monsterHp) / monster.hp * hpSegments);
  const eyeClass = monster.traits.includes("venomous") ? "is-venom" : monster.traits.includes("enrage") ? "is-enrage" : "";
  return <aside className="rr-combat rr-panel" aria-label="戦闘">
    <div className="rr-combat__stage">
      <div className={`rr-monster-portrait ${eyeClass}`}><i /><i /></div>
    </div>
    <div className="rr-combat__title">
      <div>
        <span className="rr-kicker">ROUND {combat.round}</span>
        <h3>{monster.nameJa}</h3>
        <small>{monster.name}</small>
      </div>
      <strong>{combat.monsterHp}/{monster.hp} HP</strong>
    </div>
    <div className="rr-hp-segments" aria-label={`モンスターHP ${combat.monsterHp}/${monster.hp}`}>
      {Array.from({ length: hpSegments }, (_, i) => <i className={i < hpActive ? "is-active" : ""} key={i} />)}
    </div>
    <div className="rr-traits"><span>装甲 {monster.armor}</span>{monster.traits.map(t => <span key={t}>{t}</span>)}</div>
    <p className="rr-intent">次の行動: <strong>{combat.intent.dmg} ダメージ</strong>{combat.intent.note && `・${combat.intent.note}`}</p>
    <p className="rr-player-block">{player.name}：HP {player.hp}/{player.maxHp} ・ ブロック <strong>{combat.playerBlock}</strong></p>
  </aside>;
}
