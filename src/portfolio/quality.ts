// Hero-scene quality detection (portfolio only). Same priority pattern as the game's
// detectQuality(): ?q= URL override > silent auto-detect. No localStorage, no visible UI.

export interface HeroQuality {
  tier: "high" | "balanced" | "low";
  dpr: number;
  radialSegments: number;
  tubularSegments: number;
  maxFps: 60 | 30;
  animate: boolean;
  parallax: boolean;
}

function build(tier: "high" | "balanced" | "low", reducedMotion: boolean, coarse: boolean): HeroQuality {
  const table = {
    high: {
      dpr: Math.min(1.5, window.devicePixelRatio || 1),
      radialSegments: 16,
      tubularSegments: 128,
      maxFps: 60 as const
    },
    balanced: {
      dpr: Math.min(1.25, window.devicePixelRatio || 1),
      radialSegments: 12,
      tubularSegments: 88,
      maxFps: 60 as const
    },
    low: {
      dpr: 1,
      radialSegments: 8,
      tubularSegments: 56,
      maxFps: 30 as const
    }
  }[tier];
  return {
    tier,
    ...table,
    animate: !reducedMotion,
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

  const preferred = document.documentElement.dataset.experienceQuality;
  if (preferred === "high" || preferred === "low") {
    // A visible experience control selected this tier. It still respects the OS
    // motion preference; `?q=` above remains the explicit QA escape hatch.
    return build(preferred, reducedMotion, coarse);
  }

  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  const small = window.innerWidth < 780;
  const low = memory < 3 || (coarse && small);
  const high = !low && !coarse && memory >= 4;
  return build(high ? "high" : low ? "low" : "balanced", reducedMotion, coarse);
}
