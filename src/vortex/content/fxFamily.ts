import { ACTIVE_SKILLS } from "./skills";

/**
 * Which of the eight looks a skill gets, derived from what the skill does.
 *
 * Forty-nine active skills cannot have forty-nine bespoke effects, and a
 * hand-kept table mapping id to look would go stale the first time someone
 * added a skill — the ninety-ninth would silently render as "whatever the
 * default is". Deriving from `effects` means a new skill arrives already
 * classified, and a skill whose effects change gets the look that now matches
 * it.
 *
 * The order below is the classification: first match wins, so the rarer and
 * more specific effects are tested before the near-universal
 * `stat-multiplier`, which almost every skill carries as a garnish.
 */
export type FxFamily =
  | "lance"
  | "orbit"
  | "shockring"
  | "anchor"
  | "aegis"
  | "overclock"
  | "siphon"
  | "reboot";

export const FX_FAMILIES: readonly FxFamily[] = [
  "lance",
  "orbit",
  "shockring",
  "anchor",
  "aegis",
  "overclock",
  "siphon",
  "reboot"
];

/** Silhouette first, decoration second — see ARCHITECTURE_V2.md §2. */
export interface FxFamilySpec {
  /** Layer one: the one colour that has to read in 0.3s. */
  readonly color: number;
  /** Seconds the silhouette is on screen. */
  readonly duration: number;
  /** Layer two particle budget at full quality; halved when detail is lite. */
  readonly sparks: number;
  /**
   * Drawn when several land on the same frame — higher wins, lower is dropped.
   * A knockout must never be buried under three simultaneous buffs.
   */
  readonly priority: number;
  readonly labelJa: string;
}

export const FX_FAMILY_SPECS: Record<FxFamily, FxFamilySpec> = {
  // Cyan-white spear along the line to the target: the direction is the point.
  lance: { color: 0x9fe8ff, duration: 0.32, sparks: 8, priority: 3, labelJa: "突進" },
  // Magenta arc swept tangentially, so the direction of travel is legible.
  orbit: { color: 0xff5bd7, duration: 0.35, sparks: 8, priority: 3, labelJa: "軌道" },
  /* Orange, not the amber it started as: at 0xffb448 it sat 49 units from
     overclock's gold, so an area attack and a speed buff were the same colour.
     Hotter also suits the one silhouette that means "this reaches you". */
  shockring: { color: 0xff8a2b, duration: 0.5, sparks: 12, priority: 4, labelJa: "衝撃波" },
  // Steel column pressing down; reads as weight rather than damage.
  anchor: { color: 0x9fb4c4, duration: 0.7, sparks: 6, priority: 2, labelJa: "制動" },
  /* A real blue, not another pale cyan. The first draft had this at 0x8fd8ff,
     which sat 23 units from lance in RGB — a lunge and a shield were the same
     colour, on a game where telling attack from defence is the whole read. */
  aegis: { color: 0x4a9eff, duration: 0.9, sparks: 4, priority: 2, labelJa: "防護" },
  // Gold flare up the spin axis.
  overclock: { color: 0xffd76a, duration: 0.45, sparks: 8, priority: 2, labelJa: "加速" },
  // Violet thread from victim to caster — you can see who was robbed.
  siphon: { color: 0xc08bff, duration: 0.6, sparks: 6, priority: 3, labelJa: "吸収" },
  // Green, never warm: repair must not be mistaken for a hit.
  reboot: { color: 0x6effb2, duration: 0.8, sparks: 8, priority: 2, labelJa: "再起" }
};

type EffectLike = { readonly kind: string; readonly direction?: string };

/**
 * `tangent` is an impulse direction the catalogue really uses, and it belongs
 * to orbit — reading it as a plain impulse dropped four skills into overclock
 * and anchor, where a sideways dash looked like a speed buff.
 */
/**
 * Returns null when no rule matched, so "classified as overclock" and "fell
 * through to the default" are distinguishable. A silent default is how a badly
 * classified skill would hide: it renders, it just renders as the wrong thing,
 * and nothing complains. fxSelftest asserts this never returns null.
 */
export function fxFamilyForEffects(effects: readonly EffectLike[]): FxFamily | null {
  const has = (kind: string): boolean => effects.some((effect) => effect.kind === kind);
  const impulse = effects.find((effect) => effect.kind === "impulse");

  if (has("steal-spin") || has("cooldown-shift")) return "siphon";
  if (has("durability") && has("cleanse")) return "reboot";
  if (has("radial-damage")) return "shockring";
  if (has("shield") || has("phase")) return "aegis";
  if (has("reverse-orbit") || impulse?.direction === "tangent") return "orbit";
  if (impulse?.direction === "toward-target") return "lance";
  if (impulse?.direction === "toward-center" || impulse?.direction === "away-from-target") {
    return "anchor";
  }
  if (has("spin")) return "overclock";
  if (has("physics-multiplier")) return "anchor";
  if (has("durability")) return "reboot";
  if (has("cleanse")) return "siphon";
  if (has("stat-multiplier")) return "overclock";
  return null;
}

/**
 * Built once at module load. The renderer only ever has a skill id — it must
 * not carry the catalogue around, and it must not have to think.
 */
export const FX_FAMILY_BY_SKILL_ID: ReadonlyMap<string, FxFamily> = new Map(
  (ACTIVE_SKILLS as readonly { id: string; effects: readonly EffectLike[] }[])
    .map((skill) => [skill.id, fxFamilyForEffects(skill.effects)] as const)
    .filter((entry): entry is readonly [string, FxFamily] => entry[1] !== null)
);

export function fxFamilyForSkill(skillId: string | undefined): FxFamily | null {
  if (!skillId) return null;
  return FX_FAMILY_BY_SKILL_ID.get(skillId) ?? null;
}

/**
 * The same eight colours as CSS, derived rather than retyped — a hex written
 * once in the renderer and again in the stylesheet is two facts that drift,
 * and the whole point is that the button matches the effect it fires.
 */
export const FX_FAMILY_TINTS: Record<FxFamily, string> = Object.fromEntries(
  FX_FAMILIES.map((family) => [
    family,
    `#${FX_FAMILY_SPECS[family].color.toString(16).padStart(6, "0")}`
  ])
) as Record<FxFamily, string>;
