export interface QualityTier {
  label: "HIGH" | "BALANCED" | "LOW";
  dpr: number;
  starCount: number;
  dustCount: number;
  planetSegments: number;
  bloom: boolean;
  spark: boolean;
  reducedMotion: boolean;
  mobile: boolean;
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGL2RenderingContext && canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

const QUALITY_KEY = "alice_quality";
export type QualityChoice = "auto" | "high" | "balanced" | "low";

// SAFE forced-tier builder. Gates spark by REAL hasWebGL2() so forcing HIGH on a
// WebGL1 GPU degrades instead of throwing (the HUD then honestly shows SPARK OFF).
// MSAA is not a QualityTier field — the engine derives it from
// renderer.capabilities.isWebGL2, so it self-gates already.
function forcedTier(tier: "high" | "balanced" | "low", opts: { reducedMotion: boolean; mobile: boolean }): QualityTier {
  const webgl2 = hasWebGL2();
  const base = {
    high: { label: "HIGH" as const, dpr: Math.min(2, window.devicePixelRatio || 1), starCount: 11000, dustCount: 7200, planetSegments: 144, bloom: true, spark: webgl2 && !opts.mobile },
    balanced: { label: "BALANCED" as const, dpr: Math.min(1.35, window.devicePixelRatio || 1), starCount: 3600, dustCount: 1400, planetSegments: 64, bloom: false, spark: false },
    low: { label: "LOW" as const, dpr: 1, starCount: 1100, dustCount: 280, planetSegments: 32, bloom: false, spark: false }
  }[tier];
  return { ...base, ...opts };
}

export function getQualityChoice(): QualityChoice {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(QUALITY_KEY) : null;
    return v === "high" || v === "balanced" || v === "low" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setQualityChoice(v: QualityChoice): void {
  try {
    if (v === "auto") window.localStorage.removeItem(QUALITY_KEY);
    else window.localStorage.setItem(QUALITY_KEY, v);
  } catch {
    /* private mode — ignore */
  }
}

export function detectQuality(): QualityTier {
  // Priority: ?q= URL param  >  localStorage(alice_quality)  >  auto-detect.

  // 1) QA / power-user override: ?q=high|balanced|low. Wins over everything (and disables
  //    reduced-motion so the headless preview — which forces prefers-reduced-motion => LOW — can exercise HIGH).
  const forced =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
  if (forced === "high" || forced === "balanced" || forced === "low") {
    return forcedTier(forced, { reducedMotion: false, mobile: false });
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 780;

  // 2) In-site persisted user choice = an explicit opt-in, so deliver the FULL experience:
  //    disable reduced-motion (else cinematic FX like rays/flare/MSAA stay off and "HIGH"
  //    looks half-applied). AUTO (step 3) still respects the OS reduced-motion setting.
  //    Keep REAL `mobile` so phones still get mobile-appropriate optimizations + no heavy spark.
  const saved = getQualityChoice();
  if (saved !== "auto") {
    return forcedTier(saved, { reducedMotion: false, mobile });
  }

  // 3) Auto-detect.
  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  const low = reducedMotion || memory < 3 || mobile;
  const high = !low && !mobile && memory >= 4 && hasWebGL2();

  if (high) {
    return {
      label: "HIGH",
      dpr: Math.min(2, window.devicePixelRatio || 1),
      starCount: 11000,
      dustCount: 7200,
      planetSegments: 144,
      bloom: true,
      spark: true,
      reducedMotion,
      mobile
    };
  }

  if (!low) {
    return {
      label: "BALANCED",
      dpr: Math.min(1.35, window.devicePixelRatio || 1),
      starCount: 3600,
      dustCount: 1400,
      planetSegments: 64,
      bloom: false,
      spark: false,
      reducedMotion,
      mobile
    };
  }

  return {
    label: "LOW",
    dpr: 1,
    starCount: 1100,
    dustCount: 280,
    planetSegments: 32,
    bloom: false,
    spark: false,
    reducedMotion,
    mobile
  };
}
