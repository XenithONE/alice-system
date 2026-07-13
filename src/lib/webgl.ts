export interface QualityTier {
  label: "HIGH" | "BALANCED" | "LOW";
  dpr: number;
  shadowSize: number;
  shadows: boolean;
  bloom: boolean;
  spark: boolean;
  aa: boolean;
  motes: number;
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

const QUALITY_KEY = "hw_quality";
export type QualityChoice = "auto" | "high" | "balanced" | "low";

// SAFE forced-tier builder. Gates spark by REAL hasWebGL2() so forcing HIGH on a
// WebGL1 GPU degrades instead of throwing (the HUD then honestly shows SPARK OFF).
function forcedTier(tier: "high" | "balanced" | "low", opts: { reducedMotion: boolean; mobile: boolean }): QualityTier {
  const webgl2 = hasWebGL2();
  const base = {
    high: { label: "HIGH" as const, dpr: Math.min(2, window.devicePixelRatio || 1), shadowSize: 1024, shadows: true, bloom: true, spark: webgl2 && !opts.mobile, aa: true, motes: 900 },
    balanced: { label: "BALANCED" as const, dpr: Math.min(1.35, window.devicePixelRatio || 1), shadowSize: 512, shadows: true, bloom: true, spark: false, aa: false, motes: 360 },
    low: { label: "LOW" as const, dpr: 1, shadowSize: 0, shadows: false, bloom: false, spark: false, aa: false, motes: 0 }
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
  // Priority: ?q= URL param  >  localStorage(hw_quality)  >  auto-detect.
  const forced = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
  if (forced === "high" || forced === "balanced" || forced === "low") {
    return forcedTier(forced, { reducedMotion: false, mobile: false });
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  // Touch-enabled laptops are not low-end mobile devices. Width is the useful
  // signal here; pointer type alone caused capable Windows PCs to default to
  // LOW and silently disable the Spark atmosphere.
  const mobile = window.innerWidth < 780 || (coarsePointer && window.innerWidth < 980);

  // In-site persisted user choice = an explicit opt-in, so deliver the FULL experience
  // (ignore OS reduced-motion). AUTO (below) still respects the OS setting.
  const saved = getQualityChoice();
  if (saved !== "auto") {
    return forcedTier(saved, { reducedMotion: false, mobile });
  }

  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  // Reduced-motion controls camera shake/motion, not texture, lighting, or
  // splat fidelity. Respect it without downgrading the entire 3D renderer.
  const low = memory < 3 || mobile;
  const high = !low && memory >= 4 && hasWebGL2();

  if (high) return { label: "HIGH", dpr: Math.min(2, window.devicePixelRatio || 1), shadowSize: 1024, shadows: true, bloom: true, spark: true, aa: true, motes: 900, reducedMotion, mobile };
  if (!low) return { label: "BALANCED", dpr: Math.min(1.35, window.devicePixelRatio || 1), shadowSize: 512, shadows: true, bloom: true, spark: false, aa: false, motes: 360, reducedMotion, mobile };
  return { label: "LOW", dpr: 1, shadowSize: 0, shadows: false, bloom: false, spark: false, aa: false, motes: 0, reducedMotion, mobile };
}
