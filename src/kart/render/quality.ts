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

export interface KartQuality {
  readonly label: QualityLabel;
  readonly dpr: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly postProcessing: boolean;
  readonly bloom: boolean;
  readonly propDensity: number;
  readonly particleBudget: number;
  readonly environmentMap: boolean;
  readonly mobile: boolean;
}

const TIERS: Record<QualityLabel, Omit<KartQuality, "dpr" | "mobile">> = {
  HIGH: {
    label: "HIGH",
    shadows: true,
    shadowMapSize: 2048,
    postProcessing: true,
    bloom: true,
    propDensity: 1,
    particleBudget: 1600,
    environmentMap: true,
  },
  BALANCED: {
    label: "BALANCED",
    shadows: true,
    shadowMapSize: 1024,
    postProcessing: true,
    bloom: true,
    propDensity: 0.65,
    particleBudget: 900,
    environmentMap: true,
  },
  LOW: {
    label: "LOW",
    shadows: false,
    shadowMapSize: 0,
    postProcessing: false,
    bloom: false,
    propDensity: 0.35,
    particleBudget: 420,
    environmentMap: false,
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
