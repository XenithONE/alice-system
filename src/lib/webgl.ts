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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 780;
  const memory = typeof navigator !== "undefined" && "deviceMemory" in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4)
    : 4;
  const low = reducedMotion || memory < 3 || window.innerWidth < 520;
  const high = !low && !mobile && memory >= 4 && hasWebGL2();

  if (high) {
    return {
      label: "HIGH",
      dpr: Math.min(2, window.devicePixelRatio || 1),
      starCount: 5200,
      dustCount: 2600,
      planetSegments: 96,
      bloom: true,
      spark: true,
      reducedMotion,
      mobile
    };
  }

  if (!low) {
    return {
      label: "BALANCED",
      dpr: Math.min(1.5, window.devicePixelRatio || 1),
      starCount: 3400,
      dustCount: 1500,
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
    starCount: 1800,
    dustCount: 700,
    planetSegments: 40,
    bloom: false,
    spark: false,
    reducedMotion,
    mobile
  };
}
