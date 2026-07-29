// Hero-scene quality (harbour + atelier). Priority: ?q= override > the visible
// experience control > auto-detect.

/**
 * Capabilities, not a single label.
 *
 * The old shape had one `tier` and 42 places asking `tier === "low"`, which
 * made the whole scene two-valued: balanced was high in everything but name —
 * same MSAA, same shadow pass, same geometry. A phone with 4 GB landed on
 * balanced and drew a desktop scene.
 *
 * Naming the capabilities lets a device turn off what costs it most while
 * keeping what it can afford, and lets each call site say what it actually
 * needs rather than guessing from a label.
 */
export interface HeroQuality {
  /** Kept for the places that add richness at the top end, not for gating. */
  tier: "high" | "balanced" | "low";
  /** What `tier === "low"` used to mean: fewer segments, simpler geometry. */
  detail: "full" | "lite";
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
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
      maxFps: 60 as const,
      detail: "full" as const,
      antialias: true,
      shadows: true,
      shadowMapSize: 2048
    },
    balanced: {
      dpr: Math.min(1.25, window.devicePixelRatio || 1),
      radialSegments: 12,
      tubularSegments: 88,
      maxFps: 60 as const,
      detail: "full" as const,
      antialias: true,
      shadows: true,
      shadowMapSize: 1024
    },
    low: {
      dpr: 1,
      radialSegments: 8,
      tubularSegments: 56,
      maxFps: 30 as const,
      detail: "lite" as const,
      // The two whole passes a weak GPU should not be running at all.
      antialias: false,
      shadows: false,
      shadowMapSize: 1024
    }
  }[tier];
  return {
    tier,
    ...table,
    // Phones ship 2-3x screens and the desktop caps render a visibly soft
    // scene there, so the bump stays — but 1.75 was above the desktop
    // balanced cap of 1.25, i.e. 1.96x the pixels of the machine it was
    // meant to be gentler than. 1.5 keeps the sharpness and loses the joke.
    dpr: coarse && tier !== "low" ? Math.min(1.5, window.devicePixelRatio || 1) : table.dpr,
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

  const params = new URLSearchParams(window.location.search);
  const forced = params.get("q");
  if (forced === "high" || forced === "balanced" || forced === "low") {
    // QA override: force the tier and ignore reduced-motion (headless previews force it).
    return build(forced, false, params.get("mobile") === "1");
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
  /*
   * Screen size counts, and the sibling detectQuality() in src/lib/webgl.ts has
   * always said so. This file deliberately dropped it — "a small touch screen
   * alone is NOT low-end" — to stop phones going blurry, and fixed the blur by
   * raising their dpr instead. So a phone got the low tier's reason to exist
   * and the high tier's pixel count, which is the wrong half of both.
   *
   * The blur is handled above by the dpr bump. This can go back to meaning what
   * it says.
   */
  const mobile = window.innerWidth < 780 || (coarse && window.innerWidth < 980);
  const low = memory < 3 || mobile;
  const high = !low && !coarse && memory >= 4;
  return build(high ? "high" : low ? "low" : "balanced", reducedMotion, coarse);
}
