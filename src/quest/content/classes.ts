import type { ClassDef, ClassId } from "../engine/types";

// starterDeck: exactly 8 (class basics + neutral basics)
// levelChoices: [lv2,lv3,lv4,lv5] × 3 ids from that class pool, no dups within array

export const CLASSES: Record<ClassId, ClassDef> = {
  knight: {
    id: "knight",
    name: "Knight",
    nameJa: "騎士",
    color: "#c91a09",
    hp: 32,
    starterDeck: [
      "knight-strike",
      "knight-guard",
      "knight-charge",
      "knight-rally",
      "stride",
      "jab",
      "brace",
      "study",
    ],
    levelChoices: [
      ["knight-shield-bash", "knight-fortify", "knight-smite"],
      ["knight-bulwark", "knight-shield-bash", "knight-fortify"],
      ["knight-crush", "knight-aegis", "knight-smite"],
      ["knight-crush", "knight-aegis", "knight-bulwark"],
    ],
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    nameJa: "盗賊",
    color: "#4b9f4a",
    hp: 24,
    starterDeck: [
      "rogue-stab",
      "rogue-dash",
      "rogue-feint",
      "rogue-poison-blade",
      "stride",
      "jab",
      "coin-purse",
      "study",
    ],
    levelChoices: [
      ["rogue-backstab", "rogue-pickpocket", "rogue-twin-fangs"],
      ["rogue-shadow-step", "rogue-backstab", "rogue-smoke-veil"],
      ["rogue-assassinate", "rogue-twin-fangs", "rogue-shadow-step"],
      ["rogue-assassinate", "rogue-smoke-veil", "rogue-pickpocket"],
    ],
  },
  mage: {
    id: "mage",
    name: "Mage",
    nameJa: "魔術師",
    color: "#0055bf",
    hp: 20,
    starterDeck: [
      "mage-spark",
      "mage-ward",
      "mage-focus",
      "mage-arcane-sight",
      "stride",
      "jab",
      "brace",
      "insight",
    ],
    levelChoices: [
      ["mage-bolt", "mage-frost", "mage-mana-surge"],
      ["mage-shatter", "mage-bolt", "mage-frost"],
      ["mage-fireball", "mage-nova", "mage-shatter"],
      ["mage-fireball", "mage-nova", "mage-mana-surge"],
    ],
  },
  cleric: {
    id: "cleric",
    name: "Cleric",
    nameJa: "僧侶",
    color: "#f2cd37",
    hp: 26,
    starterDeck: [
      "cleric-smite",
      "cleric-mend",
      "cleric-barrier",
      "cleric-bless",
      "stride",
      "brace",
      "first-aid",
      "study",
    ],
    levelChoices: [
      ["cleric-holy-light", "cleric-sanctuary", "cleric-purge"],
      ["cleric-divine-shield", "cleric-holy-light", "cleric-sanctuary"],
      ["cleric-judgement", "cleric-beacon", "cleric-purge"],
      ["cleric-judgement", "cleric-beacon", "cleric-divine-shield"],
    ],
  },
};
