import {
  NEUTRAL_MODIFIERS,
  TOP_SLOTS,
  type ResolvedActiveSkill,
  type ResolvedPassiveSkill,
  type ResolvedTopBuild,
  type ResolvedTopPart,
  type SimTopSlot,
} from "./types";

export interface SimFixtureOptions {
  readonly activeGroups?: Partial<
    Record<SimTopSlot, readonly ResolvedActiveSkill[]>
  >;
  readonly passives?: readonly ResolvedPassiveSkill[];
}

/**
 * Deterministic ten-collider fixture: seven part proxies plus the Edge's
 * three swept blade proxies. Kept outside production adapters so headless
 * gates do not depend on React or catalog generation.
 */
export function createSimFixtureBuild(
  index: number,
  options: SimFixtureOptions = {},
): ResolvedTopBuild<{ readonly id: string }> {
  const parts: ResolvedTopPart[] = TOP_SLOTS.map((slot, partIndex) => ({
    id: `sim-fixture-${index}-${slot}`,
    slot,
    shape: slot === "edge" ? "compound" : slot === "tip" ? "cone" : "cylinder",
    lobes: slot === "edge" ? 7 : undefined,
    radius:
      slot === "edge"
        ? 0.72 + index * 0.005
        : slot === "tip"
          ? 0.18
          : 0.32 + partIndex * 0.012,
    height: slot === "weight" ? 0.12 : slot === "tip" ? 0.14 : 0.07,
    mass: slot === "weight" ? 0.74 : 0.2 + partIndex * 0.018,
    friction: slot === "tip" ? 0.68 : 0.42,
    restitution: slot === "edge" ? 0.46 : 0.16,
    activeSkill: options.activeGroups?.[slot]?.[0] ?? null,
  }));
  const mass = parts.reduce((sum, part) => sum + part.mass, 0);
  return {
    source: { id: `sim-fixture-${index}` },
    name: `Sim Fixture ${index + 1}`,
    cost: 900,
    stats: {
      attack: 78,
      defense: 76,
      stamina: 82,
      stability: 80,
      mobility: 76,
      durability: 68,
    },
    physics: {
      mass,
      inertia: 1.08,
      centerOfMass: -0.03,
      friction: 0.55,
      restitution: 0.31,
      drag: 0.28,
      launchSpin: 96,
    },
    parts,
    activeGroups: options.activeGroups,
    passives: options.passives ?? [],
    modifiers: NEUTRAL_MODIFIERS,
    synergyIds: [],
  };
}
