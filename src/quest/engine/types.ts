// RELIC ROAD — canonical type contracts.
// ⚠ ARCHITECT-OWNED (Claude). Implementations (Codex/Grok) must conform to
// these types EXACTLY — if a type feels wrong, flag it in your report instead
// of changing it. Everything here is plain data (JSON-serializable), because
// GameState crosses the wire and the engine must stay a pure reducer.

// ── identities ───────────────────────────────────────────────────────────────
export type ClassId = "knight" | "rogue" | "mage" | "cleric";
export type Phase = "lobby" | "playing" | "finished";

// ── card / effect DSL ────────────────────────────────────────────────────────
// Cards do NOT contain code. They contain Effect[] interpreted by effects.ts.
export type Effect =
  | { t: "move"; n: number } // gain move points (overworld only)
  | { t: "dmg"; n: number; times?: number; pierce?: boolean } // combat only
  | { t: "block"; n: number } // combat only
  | { t: "heal"; n: number }
  | { t: "draw"; n: number }
  | { t: "gold"; n: number }
  | { t: "xp"; n: number }
  | { t: "energy"; n: number } // this turn
  | { t: "stun"; turns: number } // monster skips acting
  | { t: "poison"; n: number; turns: number } // monster DoT
  | { t: "buffAtk"; n: number; turns: number } // +dmg on your dmg effects
  | { t: "buffDef"; n: number; turns: number } // flat incoming-dmg reduction
  | { t: "curseGive"; card: string } // shuffle a curse card into a rival's discard (arg: seat)
  | { t: "trapNode"; dmg: number } // arm the current node against rivals
  | { t: "teleportCamp" } // jump to nearest visited camp
  | { t: "scry"; n: number } // look at top n of deck, reorder
  | { t: "loseHp"; n: number } // self-cost
  | { t: "exhaust" }; // this card removes itself from deck after play

export interface CardDef {
  id: string; // kebab-case slug, unique
  name: string; // EN display
  nameJa: string; // ja subtitle (rules text is ja)
  kind: "action" | "attack" | "skill" | "item" | "curse";
  cls: ClassId | "neutral";
  energy: number; // cost to play (0..3)
  price: number; // shop gold price (0 = not sold)
  rarity: 0 | 1 | 2; // basic / uncommon / rare
  textJa: string; // display rules text — MUST match effects
  effects: Effect[];
  combatOnly?: boolean; // attack/blocks: playable only in combat
  overworldOnly?: boolean; // move cards etc.
}

// ── monsters ────────────────────────────────────────────────────────────────
export type MonsterTrait = "first-strike" | "armored" | "venomous" | "thief" | "regen" | "enrage";

export interface MonsterDef {
  id: string;
  name: string;
  nameJa: string;
  tier: 1 | 2 | 3; // zone tier (guardians use 3)
  hp: number;
  atk: number; // base intent damage
  armor: number; // flat dmg reduction
  traits: MonsterTrait[];
  xp: number;
  gold: [number, number]; // reward range
  loot?: string[]; // possible card drops (one rolled)
  guardian?: "shrine" | "final"; // shrine guardians drop relics; final ends game
}

// ── classes ─────────────────────────────────────────────────────────────────
export interface ClassDef {
  id: ClassId;
  name: string;
  nameJa: string;
  color: string; // brick palette hex, e.g. "#c91a09"
  hp: number; // starting max hp (envelope: 20..32)
  starterDeck: string[]; // exactly 8 card ids (basics)
  levelChoices: string[][]; // [lv2, lv3, lv4, lv5] → 3 card ids each to pick 1
}

// ── events ──────────────────────────────────────────────────────────────────
export interface EventChoice {
  labelJa: string;
  goldCost?: number; // greyed out if unaffordable
  effects: Effect[]; // resolved immediately (non-combat context)
}
export interface EventDef {
  id: string;
  nameJa: string;
  textJa: string;
  tier: 1 | 2 | 3;
  choices: EventChoice[]; // 2..3 choices
}

// ── board ───────────────────────────────────────────────────────────────────
export type NodeKind =
  | "start" // shared spawn (4 pads)
  | "path" // empty — safe passage
  | "monster" // fight a tier monster
  | "elite" // fight tier+1 pick, better loot
  | "event" // draw an EventDef of the tier
  | "shop" // buy cards/items
  | "camp" // rest: heal 40% + remove a curse; respawn anchor
  | "shrine" // relic guardian (3 total, shrineIndex 0..2)
  | "portal"; // center — needs 3 relics; final guardian

export interface BoardNode {
  id: number;
  kind: NodeKind;
  tier: 1 | 2 | 3;
  x: number; // layout coords in [0,1] board space (renderer scales)
  y: number;
  edges: number[]; // undirected adjacency (ids)
  shrineIndex?: 0 | 1 | 2;
}
export interface Board {
  seed: number;
  nodes: BoardNode[];
}

// ── statuses ────────────────────────────────────────────────────────────────
export interface Status {
  t: "poison" | "stun" | "buffAtk" | "buffDef";
  n: number; // magnitude (poison dmg / buff amount; stun n unused)
  turns: number; // remaining
}

// ── per-player state ────────────────────────────────────────────────────────
export interface PendingChoice {
  t: "levelup" | "event" | "loot";
  options: string[]; // card ids (levelup/loot) — event uses eventId + its choices
  eventId?: string;
}

export interface PlayerState {
  seat: number;
  name: string;
  cls: ClassId;
  bot: boolean;
  connected: boolean;
  node: number;
  visitedCamps: number[]; // respawn/teleport anchors (node ids)
  hp: number;
  maxHp: number;
  level: number; // 1..5
  xp: number; // resets each level; threshold = level * 8
  gold: number;
  deck: string[]; // draw pile (top = end of array)
  hand: string[];
  discard: string[];
  exhaust: string[];
  relics: number[]; // shrineIndex list (win needs 0,1,2)
  statuses: Status[];
  pendingChoice: PendingChoice | null;
  deaths: number;
}

// ── combat ──────────────────────────────────────────────────────────────────
export interface CombatState {
  monsterId: string;
  monsterHp: number;
  monsterStatuses: Status[];
  playerBlock: number;
  round: number;
  intent: { dmg: number; note?: string }; // what the monster will do next
  fledFrom: number | null; // node to retreat to on flee (previous node)
  shrineIndex?: 0 | 1 | 2; // set when fighting a shrine guardian
  final?: boolean;
}

// ── game state (host-authoritative truth) ───────────────────────────────────
export interface LogEntry {
  turn: number;
  seat: number | -1; // -1 = system
  msgJa: string;
}

export interface GameState {
  version: 1;
  phase: Phase;
  seed: number;
  round: number; // full cycles of all seats
  roundLimit: number; // sudden death → most relics, then XP+level, then gold
  current: number; // seat whose turn it is
  players: PlayerState[];
  board: Board;
  shopStock: Record<number, string[]>; // nodeId → card ids (refreshes on purchase)
  traps: Record<number, { by: number; dmg: number }>;
  combat: CombatState | null; // belongs to `current` player
  energy: number; // current player's remaining energy this turn (base 3)
  moves: number; // current player's remaining move points
  winner: number | null;
  log: LogEntry[]; // host keeps last ~80
}

// ── intents (guest → host; host validates via engine) ───────────────────────
export type Intent =
  | { k: "playCard"; hand: number; targetSeat?: number } // targetSeat for curseGive
  | { k: "moveTo"; node: number } // must be adjacent + moves>0
  | { k: "combatCard"; hand: number }
  | { k: "combatEnd" } // end combat round → monster acts
  | { k: "flee" }
  | { k: "buy"; card: string }
  | { k: "rest" } // on camp
  | { k: "choose"; idx: number } // resolve pendingChoice
  | { k: "endTurn" };

export interface ApplyResult {
  ok: boolean;
  error?: string; // when !ok, state is UNCHANGED
  events: LogEntry[]; // appended by the engine (already in state.log too)
}

// ── content registry (filled by content/*, consumed by engine) ──────────────
export interface Content {
  cards: Record<string, CardDef>;
  monsters: Record<string, MonsterDef>;
  classes: Record<ClassId, ClassDef>;
  events: Record<string, EventDef>;
}

// ── engine API (implemented in engine.ts; PURE — no Date.now/Math.random) ───
// createGame(content, seed, lobby) → GameState
// applyIntent(content, state, seat, intent, rng) → ApplyResult (mutates state)
// legalIntents(content, state, seat) → Intent[]  (bot + UI hinting + tests)
export type Rng = () => number; // [0,1) — host-owned mulberry32
