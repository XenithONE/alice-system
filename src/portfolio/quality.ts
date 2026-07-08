// Hero-scene quality detection (portfolio only). Same priority pattern as the game's
// detectQuality(): ?q= URL override > silent auto-detect. No localStorage, no visible UI.

export interface HeroQuality {
  tier: "high" | "balanced" | "low";
  dpr: number;
  blades: number;
  particles: number;
  animate: boolean;
  parallax: boolean;
}

function build(tier: "high" | "balanced" | "low", reducedMotion: boolean, coarse: boolean): HeroQuality {
  const table = {
    high: { dpr: Math.min(2, window.devicePixelRatio || 1), blades: 144, particles: 450 },
    balanced: { dpr: Math.min(1.5, window.devicePixelRatio || 1), blades: 96, particles: 220 },
    low: { dpr: 1, blades: 64, particles: 0 }
  }[tier];
  return {
    tier,
    ...table,
    animate: !reducedMotion && !(tier === "low" && coarse),
    parallax: !reducedMotion && !coarse
  };
}

export function detectHeroQuality(): HeroQuality {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  const forced = new URLSearchParams(window.location.search).get("q");
  if (forced === "high" || forced === "balanced" || forced === "low") {
    // QA override: force the tier and ignore reduced-motion (headless previews force it).
    return build(forced, false, false);
  }

  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  const small = window.innerWidth < 780;
  const low = memory < 3 || (coarse && small);
  const high = !low && !coarse && memory >= 4;
  return build(high ? "high" : low ? "low" : "balanced", reducedMotion, coarse);
}
