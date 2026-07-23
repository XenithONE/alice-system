import { legalIntents } from "./engine";
import type { CardDef, Content, Effect, GameState, Intent, Rng } from "./types";

function pickOne<T>(items: readonly T[], rng: Rng): T {
  if (!items.length) throw new Error("bot has no candidate intent");
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

function bestBy<T>(items: readonly T[], score: (item: T) => number, rng: Rng): T {
  let best = -Infinity;
  const tied: T[] = [];
  for (const item of items) {
    const value = score(item);
    if (value > best) {
      best = value;
      tied.splice(0, tied.length, item);
    } else if (value === best) tied.push(item);
  }
  return pickOne(tied, rng);
}

function effectTotal(card: CardDef, kind: Effect["t"]): number {
  return card.effects.reduce((sum, effect) => {
    if (effect.t !== kind) return sum;
    if (effect.t === "dmg") return sum + effect.n * (effect.times ?? 1);
    if ("n" in effect) return sum + effect.n;
    return sum;
  }, 0);
}

function choiceValue(card: CardDef): number {
  return card.effects.reduce((sum, effect) => {
    switch (effect.t) {
      case "dmg": return sum + effect.n * (effect.times ?? 1) * 2;
      case "block":
      case "heal":
      case "gold":
      case "xp":
      case "move": return sum + effect.n;
      case "draw":
      case "energy":
      case "scry": return sum + effect.n * 3;
      case "poison": return sum + effect.n * effect.turns;
      case "stun": return sum + effect.turns * 6;
      case "buffAtk":
      case "buffDef": return sum + effect.n * effect.turns;
      case "loseHp": return sum - effect.n * 2;
      case "curseGive": return sum + 2;
      case "teleportCamp": return sum + 3;
      case "trapNode": return sum + effect.dmg;
      case "exhaust": return sum;
    }
  }, card.rarity * 2);
}

function attackBonus(state: GameState, seat: number): number {
  return state.players[seat]!.statuses
    .filter((status) => status.t === "buffAtk")
    .reduce((sum, status) => sum + status.n, 0);
}

function damageOf(content: Content, state: GameState, seat: number, card: CardDef): number {
  const armor = content.monsters[state.combat!.monsterId]?.armor ?? 0;
  const bonus = attackBonus(state, seat);
  return card.effects.reduce((sum, effect) => effect.t === "dmg"
    ? sum + Math.max(0, effect.n + bonus - (effect.pierce ? 0 : armor)) * (effect.times ?? 1)
    : sum, 0);
}

function combatCardValue(content: Content, state: GameState, seat: number, card: CardDef): number {
  const player = state.players[seat]!;
  const lowHp = player.hp < player.maxHp * 0.4;
  const damage = damageOf(content, state, seat, card);
  return card.effects.reduce((sum, effect) => {
    switch (effect.t) {
      case "dmg": return sum;
      case "block": return sum + effect.n * (lowHp ? 2 : 1);
      case "heal": return sum + Math.min(effect.n, player.maxHp - player.hp) * (lowHp ? 2 : 1);
      case "poison": return sum + effect.n * effect.turns * (lowHp ? 1 : 2);
      case "stun": return sum + effect.turns * 10;
      case "buffAtk": return sum + effect.n * effect.turns * 3;
      case "buffDef": return sum + effect.n * effect.turns * (lowHp ? 3 : 1.5);
      case "draw": return sum + effect.n * 4;
      case "energy": return sum + effect.n * 5;
      case "loseHp": return sum - effect.n * 3;
      default: return sum;
    }
  }, damage * (lowHp ? 1 : 2));
}

function cheapestLethal(
  content: Content,
  state: GameState,
  seat: number,
  cards: readonly Extract<Intent, { k: "combatCard" }>[],
  rng: Rng,
): Intent | undefined {
  const entries = cards.map((intent) => {
    const card = content.cards[state.players[seat]!.hand[intent.hand]!]!;
    return { intent, card, damage: damageOf(content, state, seat, card) };
  }).filter((entry) => entry.damage > 0);
  const lethal: typeof entries[] = [];
  for (let mask = 1; mask < 2 ** entries.length; mask += 1) {
    const combo = entries.filter((_, index) => Boolean(mask & (1 << index)));
    if (combo.reduce((sum, entry) => sum + entry.card.energy, 0) <= state.energy &&
        combo.reduce((sum, entry) => sum + entry.damage, 0) >= state.combat!.monsterHp) {
      lethal.push(combo);
    }
  }
  if (!lethal.length) return undefined;
  const combo = bestBy(lethal, (items) =>
    -items.reduce((sum, item) => sum + item.card.energy, 0) * 100 - items.length, rng);
  return bestBy(combo, (entry) => -entry.card.energy, rng).intent;
}

function shortestPath(state: GameState, seat: number, from: number, goal: number): number[] {
  const queue = [from];
  const previous = new Map<number, number>([[from, -1]]);
  while (queue.length) {
    const node = queue.shift()!;
    if (node === goal) {
      const path: number[] = [];
      for (let cursor = node; cursor !== -1; cursor = previous.get(cursor)!) path.push(cursor);
      return path.reverse();
    }
    for (const next of state.board.nodes[node]!.edges) {
      if (state.board.nodes[next]!.kind === "portal" &&
          state.players[seat]!.relics.length < 3 &&
          next !== goal) continue;
      if (!previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  throw new Error(`connected board has no path from ${from} to ${goal}`);
}

function nearestGoal(
  state: GameState,
  seat: number,
  from: number,
  candidates: readonly number[],
  rng: Rng,
): { goal: number; path: number[] } {
  const paths = candidates.map((goal) => ({ goal, path: shortestPath(state, seat, from, goal) }));
  return bestBy(paths, (entry) => -entry.path.length, rng);
}

function pickGoal(state: GameState, seat: number, rng: Rng): { goal: number; path: number[] } {
  const player = state.players[seat]!;
  const nodes = state.board.nodes;
  let candidates: number[];
  if ([0, 1, 2].every((relic) => player.relics.includes(relic))) {
    candidates = nodes.filter((node) => node.kind === "portal").map((node) => node.id);
  } else if (player.level >= 2 && player.hp >= player.maxHp * 0.65) {
    candidates = nodes.filter((node) =>
      node.kind === "shrine" &&
      node.shrineIndex !== undefined &&
      !player.relics.includes(node.shrineIndex)).map((node) => node.id);
  } else if (player.hp < player.maxHp * 0.45) {
    candidates = nodes.filter((node) => node.kind === "camp").map((node) => node.id);
  } else if (player.gold >= 30) {
    candidates = nodes.filter((node) => node.kind === "shop").map((node) => node.id);
  } else {
    const preferredKinds = player.hp >= player.maxHp * 0.6
      ? [["monster"], ["elite"], ["event"]]
      : [["monster", "elite", "event"]];
    candidates = [];
    for (const kinds of preferredKinds) {
      candidates = nodes.filter((node) =>
        node.id !== player.node && kinds.includes(node.kind)).map((node) => node.id);
      if (candidates.length) break;
    }
  }
  if (!candidates.length) {
    candidates = nodes.filter((node) => node.id !== player.node).map((node) => node.id);
  }
  return nearestGoal(state, seat, player.node, candidates, rng);
}

function deckSize(state: GameState, seat: number): number {
  const player = state.players[seat]!;
  return player.deck.length + player.hand.length + player.discard.length + player.exhaust.length;
}

export function chooseIntent(content: Content, state: GameState, seat: number, rng: Rng): Intent {
  const legal = legalIntents(content, state, seat);
  if (!legal.length) throw new Error(`no legal intents for seat ${seat}`);
  const player = state.players[seat]!;

  if (player.pendingChoice) {
    const choices = legal.filter((intent): intent is Extract<Intent, { k: "choose" }> => intent.k === "choose");
    if (player.pendingChoice.t === "event") {
      const event = content.events[player.pendingChoice.eventId!];
      return bestBy(choices, (intent) => event.choices[intent.idx]!.effects.reduce((sum, effect) => {
        if (effect.t === "gold" || effect.t === "xp" || effect.t === "heal") return sum + effect.n;
        if (effect.t === "loseHp") return sum - effect.n;
        return sum;
      }, 0), rng);
    }
    const nonSkip = choices.filter((intent) => intent.idx < player.pendingChoice!.options.length);
    return nonSkip.length
      ? bestBy(nonSkip, (intent) =>
        choiceValue(content.cards[player.pendingChoice!.options[intent.idx]!]!), rng)
      : pickOne(choices, rng);
  }

  if (state.combat) {
    const cards = legal.filter((intent): intent is Extract<Intent, { k: "combatCard" }> =>
      intent.k === "combatCard");
    const lethal = cheapestLethal(content, state, seat, cards, rng);
    if (lethal) return lethal;

    const defense = player.statuses.filter((status) => status.t === "buffDef")
      .reduce((sum, status) => sum + status.n, 0);
    const wouldDie = player.hp -
      Math.max(0, state.combat.intent.dmg - state.combat.playerBlock - defense) <= 0;
    const blockCards = cards.filter((intent) =>
      effectTotal(content.cards[player.hand[intent.hand]!]!, "block") > 0);
    if (wouldDie) {
      if (blockCards.length) {
        return bestBy(blockCards, (intent) =>
          effectTotal(content.cards[player.hand[intent.hand]!]!, "block"), rng);
      }
      return legal.find((intent) => intent.k === "flee")!;
    }

    if (cards.length) {
      const lowHp = player.hp < player.maxHp * 0.4;
      return bestBy(cards, (intent) => {
        const card = content.cards[player.hand[intent.hand]!]!;
        const preferred = lowHp
          ? effectTotal(card, "block") > 0
          : damageOf(content, state, seat, card) > 0;
        return (preferred ? 1_000 : 0) + combatCardValue(content, state, seat, card);
      }, rng);
    }
    return legal.find((intent) => intent.k === "combatEnd")!;
  }

  const { path } = pickGoal(state, seat, rng);
  const nextStep = path[1];

  if (state.moves > 0 && nextStep !== undefined) {
    const move = legal.find((intent) => intent.k === "moveTo" && intent.node === nextStep);
    if (move) return move;
  }

  const moveCards = legal.filter((intent): intent is Extract<Intent, { k: "playCard" }> =>
    intent.k === "playCard" &&
    content.cards[player.hand[intent.hand]!]!.effects.some((effect) => effect.t === "move"));
  if (moveCards.length) {
    return bestBy(moveCards, (intent) =>
      effectTotal(content.cards[player.hand[intent.hand]!]!, "move"), rng);
  }

  const here = state.board.nodes[player.node]!;
  const rest = legal.find((intent) => intent.k === "rest");
  if (here.kind === "camp" && player.hp < player.maxHp * 0.7 && state.energy >= 2 && rest) return rest;

  const buys = legal.filter((intent): intent is Extract<Intent, { k: "buy" }> => intent.k === "buy");
  if (here.kind === "shop" && deckSize(state, seat) < 22 && buys.length) {
    return bestBy(buys, (intent) => {
      const card = content.cards[intent.card]!;
      const output = effectTotal(card, "dmg") + effectTotal(card, "block") + effectTotal(card, "move");
      return output / Math.max(1, card.energy) + card.rarity * 2;
    }, rng);
  }

  const utility = legal.filter((intent): intent is Extract<Intent, { k: "playCard" }> => {
    if (intent.k !== "playCard") return false;
    return content.cards[player.hand[intent.hand]!]!.effects.some((effect) =>
      effect.t === "draw" || effect.t === "gold" || effect.t === "xp" ||
      (effect.t === "heal" && player.hp < player.maxHp * 0.8));
  });
  if (utility.length) {
    return bestBy(utility, (intent) =>
      choiceValue(content.cards[player.hand[intent.hand]!]!), rng);
  }

  return legal.find((intent) => intent.k === "endTurn") ?? pickOne(legal, rng);
}
