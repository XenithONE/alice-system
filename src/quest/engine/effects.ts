import { shuffle } from "./rng";
import type { CombatState, Content, Effect, GameState, PlayerState, Rng, Status } from "./types";

export interface EffectContext {
  content: Content;
  state: GameState;
  seat: number;
  rng: Rng;
  combat?: CombatState;
  targetSeat?: number;
  cardId?: string;
}

export interface EffectResult {
  exhaustCard: boolean;
}

function draw(player: PlayerState, count: number, rng: Rng): void {
  for (let i = 0; i < count; i += 1) {
    if (player.deck.length === 0 && player.discard.length > 0) {
      player.deck = shuffle(rng, player.discard.splice(0));
    }
    const card = player.deck.pop();
    if (card === undefined) break;
    player.hand.push(card);
  }
}

function nearestCamp(state: GameState, player: PlayerState): number | undefined {
  let best: { id: number; distance: number } | undefined;
  const from = state.board.nodes[player.node]!;
  for (const id of player.visitedCamps) {
    const camp = state.board.nodes[id];
    if (!camp) continue;
    const distance = (from.x - camp.x) ** 2 + (from.y - camp.y) ** 2;
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best?.id;
}

function pushStatus(statuses: Status[], incoming: Status): void {
  const current = statuses.find((status) => status.t === incoming.t);
  if (current) {
    current.n = Math.max(current.n, incoming.n);
    current.turns = Math.max(current.turns, incoming.turns);
  } else {
    statuses.push(incoming);
  }
}

export function applyEffects(ctx: EffectContext, effects: readonly Effect[]): EffectResult {
  const player = ctx.state.players[ctx.seat]!;
  let exhaustCard = false;
  for (const effect of effects) {
    switch (effect.t) {
      case "move":
        ctx.state.moves += effect.n;
        break;
      case "heal":
        player.hp = Math.min(player.maxHp, player.hp + effect.n);
        break;
      case "draw":
        draw(player, effect.n, ctx.rng);
        break;
      case "gold":
        player.gold = Math.max(0, player.gold + effect.n);
        break;
      case "xp":
        player.xp += effect.n;
        break;
      case "energy":
        ctx.state.energy += effect.n;
        break;
      case "curseGive": {
        // No explicit target (event choices can't pick one) → random rival.
        let rival = ctx.targetSeat === undefined ? undefined : ctx.state.players[ctx.targetSeat];
        if (!rival || rival.seat === player.seat) {
          const rivals = ctx.state.players.filter((p) => p.seat !== player.seat);
          rival = rivals.length ? rivals[Math.floor(ctx.rng() * rivals.length)] : undefined;
        }
        if (rival && rival.seat !== player.seat) {
          rival.discard.push(effect.card);
          shuffle(ctx.rng, rival.discard);
        }
        break;
      }
      case "trapNode":
        ctx.state.traps[player.node] = { by: player.seat, dmg: effect.dmg };
        break;
      case "teleportCamp": {
        const camp = nearestCamp(ctx.state, player);
        if (camp !== undefined) player.node = camp;
        break;
      }
      case "scry": {
        const count = Math.min(effect.n, player.deck.length);
        const top = player.deck.splice(player.deck.length - count, count);
        const curses = top.filter((id) => ctx.content.cards[id]?.kind === "curse");
        const rest = top.filter((id) => ctx.content.cards[id]?.kind !== "curse");
        player.deck.unshift(...curses);
        player.deck.push(...rest);
        break;
      }
      case "loseHp":
        player.hp = Math.max(0, player.hp - effect.n);
        break;
      case "exhaust":
        exhaustCard = true;
        break;
      case "dmg": {
        if (!ctx.combat) break;
        const monster = ctx.content.monsters[ctx.combat.monsterId];
        if (!monster) break;
        const bonus = player.statuses
          .filter((status) => status.t === "buffAtk")
          .reduce((sum, status) => sum + status.n, 0);
        const hit = Math.max(0, effect.n + bonus - (effect.pierce ? 0 : monster.armor));
        ctx.combat.monsterHp = Math.max(0, ctx.combat.monsterHp - hit * Math.max(1, effect.times ?? 1));
        break;
      }
      case "block":
        if (ctx.combat) ctx.combat.playerBlock += effect.n;
        break;
      case "stun":
        if (ctx.combat) pushStatus(ctx.combat.monsterStatuses, { t: "stun", n: 0, turns: effect.turns });
        break;
      case "poison":
        if (ctx.combat) pushStatus(ctx.combat.monsterStatuses, { t: "poison", n: effect.n, turns: effect.turns });
        break;
      case "buffAtk":
        pushStatus(player.statuses, { t: "buffAtk", n: effect.n, turns: effect.turns });
        break;
      case "buffDef":
        pushStatus(player.statuses, { t: "buffDef", n: effect.n, turns: effect.turns });
        break;
    }
  }
  return { exhaustCard };
}
