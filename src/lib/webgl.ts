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

export function detectQuality(): QualityTier {
  // QA / power-user override: ?q=high|balanced|low forces a tier (and disables reduced-motion
  // so the headless preview — which forces prefers-reduced-motion => LOW — can exercise HIGH).
  const forced =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
  if (forced === "high" || forced === "balanced" || forced === "low") {
    const base = {
      high: { label: "HIGH" as const, dpr: Math.min(2, window.devicePixelRatio || 1), starCount: 11000, dustCount: 7200, planetSegments: 144, bloom: true, spark: true },
      balanced: { label: "BALANCED" as const, dpr: Math.min(1.35, window.devicePixelRatio || 1), starCount: 3600, dustCount: 1400, planetSegments: 64, bloom: false, spark: false },
      low: { label: "LOW" as const, dpr: 1, starCount: 1100, dustCount: 280, planetSegments: 32, bloom: false, spark: false }
    }[forced];
    return { ...base, reducedMotion: false, mobile: false };
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 780;
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
