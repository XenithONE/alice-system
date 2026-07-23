import { generateBoard } from "./board";
import { applyEffects } from "./effects";
import { irange, mulberry32, pick, shuffle } from "./rng";
import type {
  ApplyResult,
  CardDef,
  ClassId,
  CombatState,
  Content,
  GameState,
  Intent,
  LogEntry,
  MonsterDef,
  PlayerState,
  Rng,
} from "./types";

type LobbySeat = { name: string; cls: ClassId; bot: boolean };

function addLog(state: GameState, seat: number | -1, msgJa: string, events: LogEntry[]): void {
  const entry = { turn: state.round, seat, msgJa };
  state.log.push(entry);
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
  events.push(entry);
}

function drawTo(player: PlayerState, size: number, rng: Rng): void {
  while (player.hand.length < size) {
    if (!player.deck.length && player.discard.length) player.deck = shuffle(rng, player.discard.splice(0));
    const card = player.deck.pop();
    if (card === undefined) break;
    player.hand.push(card);
  }
}

function soldCards(content: Content): CardDef[] {
  return Object.values(content.cards).filter((card) => card.price > 0 && card.kind !== "curse");
}

function stockCard(content: Content, rng: Rng): string | undefined {
  const cards = soldCards(content);
  if (!cards.length) return undefined;
  const rarityRoll = rng();
  const rarity = rarityRoll < 0.65 ? 0 : rarityRoll < 0.92 ? 1 : 2;
  const pool = cards.filter((card) => card.rarity === rarity);
  return pick(rng, pool.length ? pool : cards).id;
}

export function createGame(content: Content, seed: number, lobby: LobbySeat[]): GameState {
  if (lobby.length < 1 || lobby.length > 4) throw new Error("lobby must contain 1..4 seats");
  const rng = mulberry32(seed);
  const board = generateBoard(seed);
  const start = board.nodes.find((node) => node.kind === "start")!.id;
  const players = lobby.map<PlayerState>((entry, seat) => {
    const cls = content.classes[entry.cls];
    if (!cls) throw new Error(`unknown class: ${entry.cls}`);
    const deck = shuffle(rng, [...cls.starterDeck]);
    const player: PlayerState = {
      seat,
      name: entry.name,
      cls: entry.cls,
      bot: entry.bot,
      connected: true,
      node: start,
      visitedCamps: [],
      hp: cls.hp,
      maxHp: cls.hp,
      level: 1,
      xp: 0,
      gold: 0,
      deck,
      hand: [],
      discard: [],
      exhaust: [],
      relics: [],
      statuses: [],
      pendingChoice: null,
      deaths: 0,
    };
    drawTo(player, 5, rng);
    return player;
  });
  const shopStock: Record<number, string[]> = {};
  for (const node of board.nodes) {
    if (node.kind !== "shop") continue;
    shopStock[node.id] = [];
    for (let i = 0; i < 4; i += 1) {
      const card = stockCard(content, rng);
      if (card) shopStock[node.id]!.push(card);
    }
  }
  return {
    version: 1,
    phase: "playing",
    seed,
    round: 1,
    roundLimit: 40,
    current: 0,
    players,
    board,
    shopStock,
    traps: {},
    combat: null,
    energy: 3,
    moves: 0,
    winner: null,
    log: [],
  };
}

function fail(error: string): ApplyResult {
  return { ok: false, error, events: [] };
}

function validateCommon(state: GameState, seat: number): string | undefined {
  if (state.phase !== "playing") return "game is not playing";
  if (!state.players[seat]) return "invalid seat";
  if (state.current !== seat) return "wrong seat";
  return undefined;
}

function maybeLevel(content: Content, player: PlayerState): void {
  while (player.level < 5 && player.xp >= player.level * 8 && !player.pendingChoice) {
    player.xp -= player.level * 8;
    player.level += 1;
    player.maxHp += 4;
    player.hp = player.maxHp;
    player.pendingChoice = {
      t: "levelup",
      options: [...(content.classes[player.cls].levelChoices[player.level - 2] ?? [])],
    };
  }
}

function startNode(state: GameState): number {
  return state.board.nodes.find((node) => node.kind === "start")!.id;
}

function nearestCamp(state: GameState, player: PlayerState): number | undefined {
  const from = state.board.nodes[player.node]!;
  return player.visitedCamps
    .map((id) => state.board.nodes[id])
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .sort((a, b) =>
      ((from.x - a.x) ** 2 + (from.y - a.y) ** 2) -
      ((from.x - b.x) ** 2 + (from.y - b.y) ** 2))[0]?.id;
}

function respawn(state: GameState, player: PlayerState, events: LogEntry[]): void {
  if (player.hp > 0) return;
  player.node = nearestCamp(state, player) ?? startNode(state);
  player.hp = player.maxHp;
  player.gold = Math.floor(player.gold / 2);
  player.deaths += 1;
  player.statuses = [];
  player.pendingChoice = null;
  player.discard.push(...player.hand.splice(0));
  state.energy = 0;
  state.moves = 0;
  state.combat = null;
  addLog(state, player.seat, "倒れたためキャンプへ帰還", events);
}

function tickStatuses(statuses: PlayerState["statuses"]): PlayerState["statuses"] {
  return statuses
    .map((status) => ({ ...status, turns: status.turns - 1 }))
    .filter((status) => status.turns > 0);
}

function monsterAct(content: Content, state: GameState, player: PlayerState): number {
  const combat = state.combat!;
  const monster = content.monsters[combat.monsterId]!;
  if (monster.traits.includes("regen")) combat.monsterHp = Math.min(monster.hp, combat.monsterHp + 1);
  const stunned = combat.monsterStatuses.some((status) => status.t === "stun" && status.turns > 0);
  const playerPoison = player.statuses
    .filter((status) => status.t === "poison")
    .reduce((sum, status) => sum + status.n, 0);
  let dealt = 0;
  if (!stunned) {
    const defense = player.statuses
      .filter((status) => status.t === "buffDef")
      .reduce((sum, status) => sum + status.n, 0);
    dealt = Math.max(0, combat.intent.dmg - combat.playerBlock - defense);
    player.hp = Math.max(0, player.hp - dealt);
    player.statuses = tickStatuses(player.statuses);
    if (dealt > 0 && monster.traits.includes("venomous")) {
      const poison = player.statuses.find((status) => status.t === "poison");
      if (poison) {
        poison.n = Math.max(poison.n, 2);
        poison.turns = Math.max(poison.turns, 2);
      } else player.statuses.push({ t: "poison", n: 2, turns: 2 });
    }
    if (dealt > 0 && monster.traits.includes("thief")) player.gold = Math.max(0, player.gold - 3);
  } else player.statuses = tickStatuses(player.statuses);
  combat.playerBlock = 0;
  player.hp = Math.max(0, player.hp - playerPoison);
  const poisonDamage = combat.monsterStatuses
    .filter((status) => status.t === "poison")
    .reduce((sum, status) => sum + status.n, 0);
  combat.monsterHp = Math.max(0, combat.monsterHp - poisonDamage);
  combat.monsterStatuses = tickStatuses(combat.monsterStatuses);
  combat.round += 1;
  return dealt;
}

function refillCombatRound(state: GameState, player: PlayerState, rng: Rng): void {
  drawTo(player, 5, rng);
  state.energy = 3;
}

function prepareCombatRound(content: Content, state: GameState, player: PlayerState, rng: Rng): void {
  if (!state.combat) return;
  refillCombatRound(state, player, rng);
  const monster = content.monsters[state.combat.monsterId]!;
  const enrage = monster.traits.includes("enrage") && state.combat.monsterHp < monster.hp * 0.4;
  state.combat.intent = {
    dmg: Math.max(0, monster.atk + (rng() < 0.5 ? -1 : 1) + (enrage ? 2 : 0)),
    note: enrage ? "激昂 +2" : undefined,
  };
}

function refreshPublishedEnrage(content: Content, state: GameState): void {
  if (!state.combat) return;
  const monster = content.monsters[state.combat.monsterId]!;
  const enraged = monster.traits.includes("enrage") && state.combat.monsterHp < monster.hp * 0.4;
  const wasEnraged = state.combat.intent.note === "激昂 +2";
  if (enraged === wasEnraged) return;
  state.combat.intent.dmg = Math.max(0, state.combat.intent.dmg + (enraged ? 2 : -2));
  state.combat.intent.note = enraged ? "激昂 +2" : undefined;
}

function rollLoot(monster: MonsterDef, rng: Rng): string[] {
  if (!monster.loot?.length || rng() >= 0.4) return [];
  return shuffle(rng, [...monster.loot]).slice(0, 3);
}

function finishVictory(content: Content, state: GameState, player: PlayerState, rng: Rng, events: LogEntry[]): void {
  const combat = state.combat!;
  const monster = content.monsters[combat.monsterId]!;
  player.xp += monster.xp;
  player.gold += irange(rng, monster.gold[0], monster.gold[1]);
  if (combat.shrineIndex !== undefined && !player.relics.includes(combat.shrineIndex)) {
    player.relics.push(combat.shrineIndex);
    addLog(state, player.seat, `レリック${combat.shrineIndex + 1}を獲得`, events);
  }
  if (combat.final) {
    state.winner = player.seat;
    state.phase = "finished";
    state.combat = null;
    addLog(state, player.seat, "最終守護者を撃破して勝利", events);
    return;
  }
  maybeLevel(content, player);
  if (player.pendingChoice?.t === "levelup") {
    // No extra state field: keep the defeated combat until choose resolves, then roll loot.
    addLog(state, player.seat, `${monster.nameJa}を撃破`, events);
    return;
  }
  const loot = rollLoot(monster, rng);
  player.pendingChoice = loot.length ? { t: "loot", options: loot } : null;
  state.combat = null;
  addLog(state, player.seat, `${monster.nameJa}を撃破`, events);
}

function selectMonster(content: Content, nodeTier: 1 | 2 | 3, kind: string, rng: Rng): MonsterDef | undefined {
  const all = Object.values(content.monsters);
  let pool: MonsterDef[];
  if (kind === "shrine") pool = all.filter((monster) => monster.guardian === "shrine");
  else if (kind === "portal") pool = all.filter((monster) => monster.guardian === "final");
  else if (kind === "elite") {
    const nextTier = Math.min(3, nodeTier + 1);
    pool = all.filter((monster) =>
      !monster.guardian &&
      monster.id.startsWith("elite-") &&
      (monster.tier === nodeTier || monster.tier === nextTier));
    if (!pool.length) {
      pool = all.filter((monster) =>
        !monster.guardian && !monster.id.startsWith("elite-") && monster.tier === nextTier);
    }
  } else {
    pool = all.filter((monster) =>
      !monster.guardian && !monster.id.startsWith("elite-") && monster.tier === nodeTier);
  }
  return pool.length ? pick(rng, pool) : undefined;
}

function resolveNode(content: Content, state: GameState, player: PlayerState, previous: number, rng: Rng): string | undefined {
  const node = state.board.nodes[player.node]!;
  const trap = state.traps[node.id];
  if (trap && trap.by !== player.seat) {
    player.hp = Math.max(0, player.hp - trap.dmg);
    delete state.traps[node.id];
    if (player.hp <= 0) return undefined;
  }
  if (node.kind === "camp" && !player.visitedCamps.includes(node.id)) player.visitedCamps.push(node.id);
  if (node.kind === "event") {
    const events = Object.values(content.events).filter((event) => event.tier === node.tier);
    if (!events.length) return "no event for node tier";
    const event = pick(rng, events);
    player.pendingChoice = { t: "event", options: event.choices.map((_, i) => String(i)), eventId: event.id };
  }
  const shrineAlreadyCleared = node.kind === "shrine" &&
    node.shrineIndex !== undefined &&
    player.relics.includes(node.shrineIndex);
  if (["monster", "elite", "shrine", "portal"].includes(node.kind) && !shrineAlreadyCleared) {
    const monster = selectMonster(content, node.tier, node.kind, rng);
    if (!monster) return "no monster for node";
    state.combat = {
      monsterId: monster.id,
      monsterHp: monster.hp,
      monsterStatuses: [],
      playerBlock: 0,
      round: 1,
      intent: { dmg: monster.atk },
      fledFrom: previous,
      shrineIndex: node.kind === "shrine" ? node.shrineIndex : undefined,
      final: node.kind === "portal" ? true : undefined,
    };
    if (monster.traits.includes("first-strike")) {
      monsterAct(content, state, player);
    }
    refillCombatRound(state, player, rng);
  }
  return undefined;
}

function suddenDeath(state: GameState): void {
  const ranked = [...state.players].sort((a, b) =>
    b.relics.length - a.relics.length ||
    b.level - a.level ||
    b.xp - a.xp ||
    b.gold - a.gold ||
    b.seat - a.seat);
  state.winner = ranked[0]!.seat;
  state.phase = "finished";
}

function prevalidate(content: Content, state: GameState, seat: number, intent: Intent): string | undefined {
  const common = validateCommon(state, seat);
  if (common) return common;
  const player = state.players[seat]!;
  if (intent.k === "combatCard" || intent.k === "combatEnd" || intent.k === "flee") {
    if (!state.combat) return "not in combat";
    if (player.pendingChoice) return "choice required";
    if (intent.k === "combatCard") {
      const cardId = player.hand[intent.hand];
      const card = cardId === undefined ? undefined : content.cards[cardId];
      if (!card) return "invalid hand card";
      if (card.overworldOnly) return "overworld-only card";
      if (card.kind === "curse") return "curse cards cannot be played in combat";
      if (card.effects.some((effect) => effect.t === "curseGive")) return "curse-giving cards cannot be played in combat";
      if (card.energy > state.energy) return "not enough energy";
    }
    return undefined;
  }
  if (state.combat && !(intent.k === "choose" && player.pendingChoice && state.combat.monsterHp === 0)) return "combat active";
  if (player.pendingChoice && intent.k !== "choose") return "choice required";
  if (!player.pendingChoice && intent.k === "choose") return "no pending choice";
  switch (intent.k) {
    case "playCard": {
      const cardId = player.hand[intent.hand];
      const card = cardId === undefined ? undefined : content.cards[cardId];
      if (!card) return "invalid hand card";
      if (card.combatOnly) return "combat-only card";
      if (card.energy > state.energy) return "not enough energy";
      const curse = card.effects.find((effect) => effect.t === "curseGive");
      if (curse) {
        const target = intent.targetSeat === undefined ? undefined : state.players[intent.targetSeat];
        if (!target || target.seat === seat || target.hp <= 0) return "curse requires a living rival target";
        if (!content.cards[curse.card]) return "unknown curse card";
      }
      return undefined;
    }
    case "moveTo": {
      if (state.moves <= 0) return "no moves";
      if (!state.board.nodes[player.node]!.edges.includes(intent.node)) return "node is not adjacent";
      const node = state.board.nodes[intent.node];
      if (!node) return "invalid node";
      if (node.kind === "portal" && player.relics.length < 3) return "portal requires 3 relics";
      if (node.kind === "event" && !Object.values(content.events).some((event) => event.tier === node.tier)) return "no event for node tier";
      if (["monster", "elite", "shrine", "portal"].includes(node.kind) && !selectMonster(content, node.tier, node.kind, () => 0)) return "no monster for node";
      return undefined;
    }
    case "buy": {
      const node = state.board.nodes[player.node]!;
      const stock = state.shopStock[node.id] ?? [];
      const card = content.cards[intent.card];
      if (node.kind !== "shop") return "not at shop";
      if (!stock.includes(intent.card) || !card) return "card not in stock";
      if (player.gold < card.price) return "not enough gold";
      return undefined;
    }
    case "rest":
      if (state.board.nodes[player.node]!.kind !== "camp") return "not at camp";
      return state.energy >= 2 ? undefined : "rest requires 2 energy";
    case "choose": {
      const pending = player.pendingChoice!;
      const maySkip = pending.t === "loot" && intent.idx === pending.options.length;
      if (!Number.isInteger(intent.idx) || intent.idx < 0 || (intent.idx >= pending.options.length && !maySkip)) return "invalid choice";
      if (pending.t === "event") {
        const event = pending.eventId ? content.events[pending.eventId] : undefined;
        const choice = event?.choices[intent.idx];
        if (!choice) return "invalid event choice";
        if ((choice.goldCost ?? 0) > player.gold) return "not enough gold";
      } else if (!maySkip && !content.cards[pending.options[intent.idx]!]) return "unknown choice card";
      return undefined;
    }
    case "endTurn":
      return state.combat ? "combat active" : undefined;
    default:
      return "unsupported intent";
  }
}

export function applyIntent(content: Content, state: GameState, seat: number, intent: Intent, rng: Rng): ApplyResult {
  const error = prevalidate(content, state, seat, intent);
  if (error) return fail(error);
  const player = state.players[seat]!;
  const events: LogEntry[] = [];
  switch (intent.k) {
    case "playCard": {
      const cardId = player.hand[intent.hand]!;
      const card = content.cards[cardId]!;
      state.energy -= card.energy;
      player.hand.splice(intent.hand, 1);
      const result = applyEffects({ content, state, seat, rng, targetSeat: intent.targetSeat, cardId }, card.effects);
      (result.exhaustCard ? player.exhaust : player.discard).push(cardId);
      maybeLevel(content, player);
      addLog(state, seat, `${card.nameJa}を使用`, events);
      respawn(state, player, events);
      break;
    }
    case "moveTo": {
      const previous = player.node;
      player.node = intent.node;
      state.moves -= 1;
      resolveNode(content, state, player, previous, rng);
      addLog(state, seat, `ノード${intent.node}へ移動`, events);
      respawn(state, player, events);
      break;
    }
    case "buy": {
      const card = content.cards[intent.card]!;
      const stock = state.shopStock[player.node]!;
      player.gold -= card.price;
      player.discard.push(card.id);
      stock.splice(stock.indexOf(card.id), 1);
      const replacement = stockCard(content, rng);
      if (replacement) stock.push(replacement);
      addLog(state, seat, `${card.nameJa}を購入`, events);
      break;
    }
    case "rest": {
      state.energy -= 2;
      player.hp = Math.min(player.maxHp, player.hp + Math.ceil(player.maxHp * 0.4));
      const piles = [player.discard, player.deck];
      for (const pile of piles) {
        const index = pile.findIndex((id) => content.cards[id]?.kind === "curse");
        if (index >= 0) {
          pile.splice(index, 1);
          break;
        }
      }
      addLog(state, seat, "キャンプで休息", events);
      break;
    }
    case "choose": {
      const pending = player.pendingChoice!;
      if (pending.t === "event") {
        const choice = content.events[pending.eventId!]!.choices[intent.idx]!;
        player.gold -= choice.goldCost ?? 0;
        player.pendingChoice = null;
        applyEffects({ content, state, seat, rng }, choice.effects);
        maybeLevel(content, player);
      } else {
        // Loot uniquely supports idx === options.length as an explicit skip.
        if (intent.idx < pending.options.length) player.discard.push(pending.options[intent.idx]!);
        player.pendingChoice = null;
        maybeLevel(content, player);
        if (pending.t === "levelup" && state.combat?.monsterHp === 0 && !player.pendingChoice) {
          // Victory deferred its loot roll until after this level-up choice.
          const monster = content.monsters[state.combat.monsterId]!;
          const loot = rollLoot(monster, rng);
          player.pendingChoice = loot.length ? { t: "loot", options: loot } : null;
          state.combat = null;
        }
      }
      addLog(state, seat, "選択を決定", events);
      respawn(state, player, events);
      break;
    }
    case "endTurn": {
      player.discard.push(...player.hand.splice(0));
      player.statuses = player.statuses
        .map((status) => ({ ...status, turns: status.turns - 1 }))
        .filter((status) => status.turns > 0);
      const wrapped = state.current === state.players.length - 1;
      state.current = (state.current + 1) % state.players.length;
      if (wrapped && state.round >= state.roundLimit) {
        suddenDeath(state);
      } else {
        if (wrapped) state.round += 1;
        const next = state.players[state.current]!;
        drawTo(next, 5, rng);
        state.energy = 3;
        state.moves = 0;
      }
      addLog(state, seat, "ターン終了", events);
      break;
    }
    case "combatCard": {
      const combat = state.combat!;
      const cardId = player.hand[intent.hand]!;
      const card = content.cards[cardId]!;
      state.energy -= card.energy;
      player.hand.splice(intent.hand, 1);
      const result = applyEffects({ content, state, seat, rng, combat, cardId }, card.effects);
      (result.exhaustCard ? player.exhaust : player.discard).push(cardId);
      refreshPublishedEnrage(content, state);
      addLog(state, seat, `${card.nameJa}を戦闘で使用`, events);
      respawn(state, player, events);
      if (state.combat && combat.monsterHp <= 0) finishVictory(content, state, player, rng, events);
      break;
    }
    case "combatEnd": {
      monsterAct(content, state, player);
      addLog(state, seat, "モンスターが行動", events);
      respawn(state, player, events);
      if (state.combat?.monsterHp === 0) finishVictory(content, state, player, rng, events);
      else if (state.combat) prepareCombatRound(content, state, player, rng);
      break;
    }
    case "flee": {
      const combat = state.combat!;
      const damage = Math.max(0, Math.ceil(combat.intent.dmg / 2) - combat.playerBlock);
      player.hp = Math.max(0, player.hp - damage);
      player.node = combat.fledFrom ?? nearestCamp(state, player) ?? startNode(state);
      state.combat = null;
      addLog(state, seat, "戦闘から逃走", events);
      respawn(state, player, events);
      break;
    }
  }
  return { ok: true, events };
}

export function legalIntents(content: Content, state: GameState, seat: number): Intent[] {
  if (validateCommon(state, seat)) return [];
  const player = state.players[seat]!;
  if (player.pendingChoice) {
    const count = player.pendingChoice.options.length + (player.pendingChoice.t === "loot" ? 1 : 0);
    return Array.from({ length: count }, (_, idx) => ({ k: "choose", idx }) as Intent)
      .filter((intent) => !prevalidate(content, state, seat, intent));
  }
  if (state.combat) {
    const intents: Intent[] = [];
    player.hand.forEach((cardId, hand) => {
      const card = content.cards[cardId];
      if (card && !card.overworldOnly && card.energy <= state.energy) intents.push({ k: "combatCard", hand });
    });
    intents.push({ k: "combatEnd" }, { k: "flee" });
    return intents.filter((intent) => !prevalidate(content, state, seat, intent));
  }
  const intents: Intent[] = [];
  player.hand.forEach((_, hand) => {
    const base: Intent = { k: "playCard", hand };
    const card = content.cards[player.hand[hand]!];
    const needsTarget = card?.effects.some((effect) => effect.t === "curseGive");
    if (needsTarget) {
      state.players.forEach((target) => {
        const targeted: Intent = { k: "playCard", hand, targetSeat: target.seat };
        if (!prevalidate(content, state, seat, targeted)) intents.push(targeted);
      });
    } else if (!prevalidate(content, state, seat, base)) intents.push(base);
  });
  if (state.moves > 0) {
    for (const node of state.board.nodes[player.node]!.edges) {
      const move: Intent = { k: "moveTo", node };
      if (!prevalidate(content, state, seat, move)) intents.push(move);
    }
  }
  const here = state.board.nodes[player.node]!;
  if (here.kind === "shop") {
    for (const card of state.shopStock[here.id] ?? []) {
      const buy: Intent = { k: "buy", card };
      if (!prevalidate(content, state, seat, buy)) intents.push(buy);
    }
  }
  if (here.kind === "camp") {
    const rest: Intent = { k: "rest" };
    if (!prevalidate(content, state, seat, rest)) intents.push(rest);
  }
  intents.push({ k: "endTurn" });
  return intents;
}
