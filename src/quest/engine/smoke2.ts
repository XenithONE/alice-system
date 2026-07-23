import { applyIntent, createGame } from "./engine";
import { mulberry32 } from "./rng";
import type { CardDef, ClassDef, Content, EventDef, MonsterDef } from "./types";

const strike: CardDef = {
  id: "strike", name: "Strike", nameJa: "ストライク", kind: "attack", cls: "knight",
  energy: 1, price: 0, rarity: 0, textJa: "20ダメージ。", effects: [{ t: "dmg", n: 20 }],
  combatOnly: true,
};
const guard: CardDef = {
  id: "guard", name: "Guard", nameJa: "ガード", kind: "skill", cls: "knight",
  energy: 1, price: 0, rarity: 0, textJa: "移動1、ブロック5。", effects: [{ t: "move", n: 1 }, { t: "block", n: 5 }],
};
const monster = (id: string, tier: 1 | 2 | 3, guardian?: "shrine" | "final"): MonsterDef => ({
  id, name: id, nameJa: id, tier, hp: guardian ? 30 : 8, atk: 2, armor: 0,
  traits: [], xp: 1, gold: [1, 1], guardian,
});
const knight: ClassDef = {
  id: "knight", name: "Knight", nameJa: "ナイト", color: "#c91a09", hp: 32,
  starterDeck: ["strike", "guard", "strike", "guard", "strike", "guard", "strike", "guard"],
  levelChoices: [[], [], [], []],
};
const event: EventDef = {
  id: "quiet", nameJa: "静寂", textJa: "何も起きない。", tier: 1,
  choices: [{ labelJa: "進む", effects: [] }, { labelJa: "待つ", effects: [] }],
};
const content: Content = {
  cards: { strike, guard },
  monsters: {
    tier1: monster("tier1", 1),
    tier2: monster("tier2", 2),
    tier3: monster("tier3", 3),
    shrine: monster("shrine", 3, "shrine"),
    final: monster("final", 3, "final"),
  },
  // The smoke only creates knights; the canonical registry type covers all four classes.
  classes: { knight } as Content["classes"],
  events: { quiet: event },
};

const rng = mulberry32(5);
const state = createGame(content, 5, [
  { name: "P1", cls: "knight", bot: false },
  { name: "P2", cls: "knight", bot: false },
]);
const player = state.players[0]!;
const neighbor = state.board.nodes[player.node]!.edges[0]!;
state.board.nodes[neighbor]!.kind = "monster";
state.board.nodes[neighbor]!.tier = 1;
player.hand = ["guard", "strike"];

const sequence = [
  { k: "playCard", hand: 0 } as const,
  { k: "moveTo", node: neighbor } as const,
  { k: "combatCard", hand: 0 } as const,
];
for (const intent of sequence) {
  const result = applyIntent(content, state, 0, intent, rng);
  if (!result.ok) throw new Error(`${intent.k}: ${result.error}`);
}
if (state.combat) throw new Error(`monster survived with ${state.combat.monsterHp} HP`);
console.log(state.log.slice(-6));
