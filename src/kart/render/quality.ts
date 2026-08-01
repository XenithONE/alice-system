/**
 * Quality tiers as capability flags, not a label.
 *
 * The portfolio shipped a `tier` string with `tier === "low"` tested in 42
 * places, which meant "balanced" was identical to "high" in everything but
 * name — and the detector only looked at device memory, never at how many
 * pixels the screen was actually asking for. Each field below is read
 * somewhere specific, and the phone check is on pixel count.
 */

export type QualityLabel = "HIGH" | "BALANCED" | "LOW";

/** Anti-aliasing strategy. LOW never builds a composer, so it keeps MSAA. */
export type AaMode = "smaa" | "fxaa" | "none";

export interface KartQuality {
  readonly label: QualityLabel;
  readonly dpr: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /**
   * Cascades in the shadow map. 1 is the single map the game shipped with,
   * whose ±78 m extent follows the focus kart — which is why nothing outside a
   * 156 m box around the player has ever cast a shadow, and why the lighthouse,
   * the grandstands and the distant props read as painted scenery. 0 means no
   * shadows at all; `shadows` stays the gate for that.
   */
  readonly shadowCascades: number;
  readonly postProcessing: boolean;
  readonly bloom: boolean;
  readonly aa: AaMode;
  readonly propDensity: number;
  readonly particleBudget: number;
  readonly environmentMap: boolean;
  /** Skid-mark ring buffer capacity, in quads. */
  readonly skidQuads: number;
  /** Billboard clouds in the sky (0 disables the layer). */
  readonly cloudCount: number;
  /** Grandstands at the start straight (0 disables). */
  readonly grandstands: number;
  /** 1 = full set dressing, 0.5 = half instances, 0.25 = landmarks only. */
  readonly setPieceDetail: number;
  /** Rain streaks when the weather says so. */
  readonly rainParticles: number;
  /**
   * When the measured FPS drops below this, the scene sheds one expensive
   * feature (AA → bloom → dpr → shadows), once, irreversibly. 0 disables.
   */
  readonly shedFloorFps: number;
  readonly mobile: boolean;
}

const TIERS: Record<QualityLabel, Omit<KartQuality, "dpr" | "mobile">> = {
  HIGH: {
    label: "HIGH",
    shadows: true,
    shadowMapSize: 2048,
    shadowCascades: 3,
    postProcessing: true,
    bloom: true,
    aa: "smaa",
    propDensity: 1,
    particleBudget: 1600,
    environmentMap: true,
    skidQuads: 4096,
    cloudCount: 26,
    grandstands: 2,
    setPieceDetail: 1,
    rainParticles: 400,
    shedFloorFps: 30,
  },
  BALANCED: {
    label: "BALANCED",
    shadows: true,
    shadowMapSize: 1024,
    shadowCascades: 1,
    postProcessing: true,
    bloom: true,
    aa: "fxaa",
    propDensity: 0.65,
    particleBudget: 900,
    environmentMap: true,
    skidQuads: 3072,
    cloudCount: 14,
    grandstands: 1,
    setPieceDetail: 0.5,
    rainParticles: 240,
    shedFloorFps: 24,
  },
  LOW: {
    label: "LOW",
    shadows: false,
    shadowMapSize: 0,
    shadowCascades: 0,
    postProcessing: false,
    bloom: false,
    aa: "none",
    propDensity: 0.35,
    particleBudget: 420,
    environmentMap: false,
    skidQuads: 1536,
    cloudCount: 0,
    grandstands: 0,
    setPieceDetail: 0.25,
    rainParticles: 120,
    shedFloorFps: 0,
  },
};

export const QUALITY_KEY = "nk_quality";
export type QualityChoice = "auto" | "high" | "balanced" | "low";

export function readQualityChoice(): QualityChoice {
  try {
    const stored = window.localStorage.getItem(QUALITY_KEY);
    return stored === "high" || stored === "balanced" || stored === "low"
      ? stored
      : "auto";
  } catch {
    return "auto";
  }
}

export function writeQualityChoice(choice: QualityChoice): void {
  try {
    if (choice === "auto") window.localStorage.removeItem(QUALITY_KEY);
    else window.localStorage.setItem(QUALITY_KEY, choice);
  } catch {
    // Private browsing. The choice simply does not persist.
  }
}

export interface QualityProbe {
  readonly deviceMemory: number;
  readonly hardwareConcurrency: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly coarsePointer: boolean;
  readonly webgl2: boolean;
}

export function probeEnvironment(): QualityProbe {
  const navigatorAny = navigator as Navigator & { deviceMemory?: number };
  let webgl2 = false;
  try {
    webgl2 = Boolean(
      window.WebGL2RenderingContext &&
        document.createElement("canvas").getContext("webgl2"),
    );
  } catch {
    webgl2 = false;
  }
  return {
    deviceMemory: navigatorAny.deviceMemory ?? 8,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 4,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    coarsePointer:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
    webgl2,
  };
}

export function resolveQuality(
  choice: QualityChoice,
  probe: QualityProbe,
): KartQuality {
  const mobile =
    probe.innerWidth < 820 || (probe.coarsePointer && probe.innerWidth < 1024);
  let label: QualityLabel;
  if (choice !== "auto") {
    label = choice.toUpperCase() as QualityLabel;
  } else if (!probe.webgl2 || probe.deviceMemory < 3) {
    label = "LOW";
  } else if (
    mobile ||
    probe.deviceMemory < 6 ||
    probe.hardwareConcurrency <= 4 ||
    // A 4K desktop panel asks for four times the pixels of a 1080p one; the
    // GPU behind it is not necessarily four times the GPU.
    probe.innerWidth * probe.innerHeight * probe.devicePixelRatio ** 2 >
      5_000_000
  ) {
    label = "BALANCED";
  } else {
    label = "HIGH";
  }
  const base = TIERS[label];
  const dprCap = label === "HIGH" ? 2 : label === "BALANCED" ? 1.5 : 1;
  return {
    ...base,
    dpr: Math.min(dprCap, probe.devicePixelRatio),
    mobile,
  };
}
