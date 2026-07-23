import type { ClassId, Content } from "../engine/types";
import { CARDS } from "./cards";
import { CLASSES } from "./classes";
import { EVENTS } from "./events";
import { MONSTERS } from "./monsters";

export function buildContent(): Content {
  return {
    cards: CARDS,
    monsters: MONSTERS,
    classes: CLASSES,
    events: EVENTS,
  };
}

/** Returns problem strings; empty array means content is consistent. */
export function validateContent(c: Content): string[] {
  const problems: string[] = [];

  // ── duplicate / key mismatch on cards ────────────────────────────────────
  const cardIds = Object.keys(c.cards);
  const cardIdSet = new Set<string>();
  for (const id of cardIds) {
    const card = c.cards[id];
    if (card.id !== id) {
      problems.push(`card key "${id}" !== card.id "${card.id}"`);
    }
    if (cardIdSet.has(card.id)) {
      problems.push(`duplicate card id "${card.id}"`);
    }
    cardIdSet.add(card.id);
  }

  // ── monsters: key/id, loot refs, envelope ─────────────────────────────────
  const monsterIdSet = new Set<string>();
  for (const id of Object.keys(c.monsters)) {
    const m = c.monsters[id];
    if (m.id !== id) problems.push(`monster key "${id}" !== monster.id "${m.id}"`);
    if (monsterIdSet.has(m.id)) problems.push(`duplicate monster id "${m.id}"`);
    monsterIdSet.add(m.id);

    if (m.loot) {
      for (const lootId of m.loot) {
        if (!c.cards[lootId]) {
          problems.push(`monster "${m.id}" loot missing card "${lootId}"`);
        }
      }
    }

    // envelope checks (skip final XP/gold which may be 0)
    const env = monsterEnvelope(m);
    if (env) problems.push(...env);
  }

  // ── events: key/id ───────────────────────────────────────────────────────
  const eventIdSet = new Set<string>();
  for (const id of Object.keys(c.events)) {
    const e = c.events[id];
    if (e.id !== id) problems.push(`event key "${id}" !== event.id "${e.id}"`);
    if (eventIdSet.has(e.id)) problems.push(`duplicate event id "${e.id}"`);
    eventIdSet.add(e.id);
    if (e.choices.length < 2 || e.choices.length > 3) {
      problems.push(`event "${e.id}" choices length ${e.choices.length} (need 2..3)`);
    }
  }

  // ── classes: starterDeck / levelChoices ──────────────────────────────────
  const classIds: ClassId[] = ["knight", "rogue", "mage", "cleric"];
  for (const cid of classIds) {
    const cls = c.classes[cid];
    if (!cls) {
      problems.push(`missing class "${cid}"`);
      continue;
    }
    if (cls.id !== cid) problems.push(`class key "${cid}" !== class.id "${cls.id}"`);

    if (cls.starterDeck.length !== 8) {
      problems.push(
        `class "${cid}" starterDeck length ${cls.starterDeck.length} (need 8)`,
      );
    }
    for (const cardId of cls.starterDeck) {
      if (!c.cards[cardId]) {
        problems.push(`class "${cid}" starterDeck missing card "${cardId}"`);
      }
    }

    if (!Array.isArray(cls.levelChoices) || cls.levelChoices.length !== 4) {
      problems.push(
        `class "${cid}" levelChoices length ${cls.levelChoices?.length ?? 0} (need 4 arrays)`,
      );
    } else {
      cls.levelChoices.forEach((arr, i) => {
        if (!Array.isArray(arr) || arr.length !== 3) {
          problems.push(
            `class "${cid}" levelChoices[${i}] length ${arr?.length ?? 0} (need 3)`,
          );
          return;
        }
        const seen = new Set<string>();
        for (const cardId of arr) {
          if (seen.has(cardId)) {
            problems.push(
              `class "${cid}" levelChoices[${i}] duplicate "${cardId}"`,
            );
          }
          seen.add(cardId);
          if (!c.cards[cardId]) {
            problems.push(
              `class "${cid}" levelChoices[${i}] missing card "${cardId}"`,
            );
          } else if (c.cards[cardId].cls !== cid) {
            problems.push(
              `class "${cid}" levelChoices[${i}] card "${cardId}" is cls ${c.cards[cardId].cls}`,
            );
          }
        }
      });
    }
  }

  // ── card energy envelope (soft sanity) ───────────────────────────────────
  for (const id of cardIds) {
    const card = c.cards[id];
    if (card.energy < 0 || card.energy > 3) {
      problems.push(`card "${id}" energy ${card.energy} out of 0..3`);
    }
    if (card.kind === "curse") {
      if (card.energy < 1) problems.push(`curse "${id}" energy must be >= 1`);
      if (card.price !== 0) problems.push(`curse "${id}" price must be 0`);
    }
  }

  // ── curseGive targets must exist ─────────────────────────────────────────
  const curseGiveSources = new Set<string>(); // curse card ids that have an entry path
  for (const id of cardIds) {
    for (const eff of c.cards[id].effects) {
      if (eff.t === "curseGive") {
        if (!c.cards[eff.card]) {
          problems.push(`card "${id}" curseGive missing card "${eff.card}"`);
        } else {
          curseGiveSources.add(eff.card);
        }
      }
    }
  }
  for (const eid of Object.keys(c.events)) {
    for (const choice of c.events[eid].choices) {
      for (const eff of choice.effects) {
        if (eff.t === "curseGive") {
          if (!c.cards[eff.card]) {
            problems.push(`event "${eid}" curseGive missing card "${eff.card}"`);
          } else {
            curseGiveSources.add(eff.card);
          }
        }
      }
    }
  }

  // ── every curse card must be reachable via at least one curseGive ───────
  for (const id of cardIds) {
    const card = c.cards[id];
    if (card.kind === "curse" && !curseGiveSources.has(id)) {
      problems.push(`curse "${id}" has no curseGive entry path (unreachable)`);
    }
  }

  return problems;
}

// ── monster balance envelope table ──────────────────────────────────────────
function monsterEnvelope(m: {
  id: string;
  tier: 1 | 2 | 3;
  hp: number;
  atk: number;
  armor: number;
  xp: number;
  gold: [number, number];
  guardian?: "shrine" | "final";
  traits: string[];
}): string[] {
  const p: string[] = [];
  const push = (field: string, v: number, lo: number, hi: number) => {
    if (v < lo || v > hi) {
      p.push(
        `monster "${m.id}" ${field}=${v} outside envelope [${lo}..${hi}]`,
      );
    }
  };

  if (m.guardian === "final") {
    push("hp", m.hp, 70, 85);
    push("atk", m.atk, 11, 13);
    push("armor", m.armor, 2, 3);
    return p;
  }
  if (m.guardian === "shrine") {
    push("hp", m.hp, 40, 55);
    push("atk", m.atk, 8, 11);
    push("armor", m.armor, 2, 2);
    push("xp", m.xp, 15, 15);
    push("gold[0]", m.gold[0], 20, 20);
    push("gold[1]", m.gold[1], 20, 20);
    return p;
  }

  // Detect elite by id prefix (content convention) for stricter table
  const elite = m.id.startsWith("elite-");
  if (elite) {
    // elite = tier table ×1.5 HP/XP/gold, ATK+1, armor+1
    if (m.tier === 1) {
      push("hp", m.hp, 12, 21);
      push("atk", m.atk, 3, 5);
      push("armor", m.armor, 1, 2);
      push("xp", m.xp, 4, 8); // 3*1.5..5*1.5 rounded
      push("gold[0]", m.gold[0], 6, 12);
      push("gold[1]", m.gold[1], 6, 12);
    } else if (m.tier === 2) {
      push("hp", m.hp, 24, 39);
      push("atk", m.atk, 5, 8);
      push("armor", m.armor, 1, 3);
      push("xp", m.xp, 9, 14);
      push("gold[0]", m.gold[0], 12, 21);
      push("gold[1]", m.gold[1], 12, 21);
    } else {
      push("hp", m.hp, 42, 63);
      push("atk", m.atk, 8, 11);
      push("armor", m.armor, 2, 4);
      push("xp", m.xp, 15, 21);
      push("gold[0]", m.gold[0], 18, 30);
      push("gold[1]", m.gold[1], 18, 30);
    }
    return p;
  }

  if (m.tier === 1) {
    push("hp", m.hp, 8, 14);
    push("atk", m.atk, 2, 4);
    push("armor", m.armor, 0, 1);
    push("xp", m.xp, 3, 5);
    push("gold[0]", m.gold[0], 4, 8);
    push("gold[1]", m.gold[1], 4, 8);
  } else if (m.tier === 2) {
    push("hp", m.hp, 16, 26);
    push("atk", m.atk, 4, 7);
    push("armor", m.armor, 0, 2);
    push("xp", m.xp, 6, 9);
    push("gold[0]", m.gold[0], 8, 14);
    push("gold[1]", m.gold[1], 8, 14);
  } else {
    push("hp", m.hp, 28, 42);
    push("atk", m.atk, 7, 10);
    push("armor", m.armor, 1, 3);
    push("xp", m.xp, 10, 14);
    push("gold[0]", m.gold[0], 12, 20);
    push("gold[1]", m.gold[1], 12, 20);
  }
  if (m.gold[0] > m.gold[1]) {
    p.push(`monster "${m.id}" gold range inverted`);
  }
  return p;
}

export { CARDS } from "./cards";
export { CLASSES } from "./classes";
export { EVENTS } from "./events";
export { MONSTERS } from "./monsters";
