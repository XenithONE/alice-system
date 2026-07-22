// Hero-scene quality detection (portfolio only). Same priority pattern as the game's
// detectQuality(): ?q= URL override > silent auto-detect. No localStorage, no visible UI.

export interface HeroQuality {
  tier: "high" | "balanced" | "low";
  dpr: number;
  radialSegments: number;
  tubularSegments: number;
  maxFps: 60 | 30;
  motionScale: 0 | 1;
  parallax: boolean;
  coarse: boolean;
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
    // Phones ship 2–3x screens: the desktop dpr caps (1.25/1.5) render a
    // visibly blurry hero there. Capable coarse devices get a higher cap;
    // genuinely weak ones stay on the low tier's dpr 1.
    dpr: coarse && tier !== "low" ? Math.min(1.75, window.devicePixelRatio || 1) : table.dpr,
    // Reduced motion keeps the real 3D composition visible by default, but
    // freezes ambient looping motion and uses the lower frame-rate budget.
    maxFps: reducedMotion ? 30 : table.maxFps,
    motionScale: reducedMotion ? 0 : 1,
    parallax: !reducedMotion && !coarse,
    coarse
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
    // A visible experience control selected this tier. The motion preference is
    // still applied, but it never replaces the 3D composition with a poster.
    return build(preferred, reducedMotion, coarse);
  }

  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  // "low" is for genuinely weak hardware only — a small touch screen alone is
  // NOT low-end (blanket-classing phones as low made the hero blurry there).
  const low = memory < 3;
  const high = !low && !coarse && memory >= 4;
  return build(high ? "high" : low ? "low" : "balanced", reducedMotion, coarse);
}
