import type { MountFace, PartDef, WeaponDef } from "../sim/types";

export type ShapeKind =
  | "tyre" | "track"
  | "saw-disc" | "drill" | "drum" | "bar-spinner" | "shell-spinner"
  | "flipper" | "lifter" | "hammer" | "spear" | "crusher"
  | "flame" | "wedge" | "fork" | "spike" | "plate" | "utility";

export interface PartPlan {
  readonly shape: ShapeKind;
  readonly rotor?: { readonly axis: "u" | "v" | "n"; readonly pair: boolean };
  readonly teeth?: number;
}

function rotorPlan(part: WeaponDef, face: MountFace): PartPlan | null {
  if (part.effect !== "spin" && part.effect !== "grind") return null;
  const axis = part.spinAxis !== "vertical"
    ? "n"
    : face === "left" || face === "right"
      ? "v"
      : "u";
  const rotor = { axis, pair: part.pairMount === true } as const;
  if (part.type === "drill") return { shape: "drill", rotor, teeth: 2 };
  if (part.type === "drum") return { shape: "drum", rotor, teeth: 3 };
  if (part.type === "saw") return { shape: "saw-disc", rotor, teeth: 18 };
  if (part.type === "spinner") {
    const aspect = Math.max(...part.cells) / Math.max(1, Math.min(...part.cells));
    if (aspect >= 2.2) return { shape: "bar-spinner", rotor, teeth: 2 };
    if (part.spinAxis === "vertical") return { shape: "shell-spinner", rotor, teeth: 3 };
    return { shape: "saw-disc", rotor, teeth: 12 };
  }
  return { shape: "drum", rotor, teeth: 3 };
}

export function partPlan(part: PartDef, face: MountFace): PartPlan {
  if (part.category === "drive") {
    return { shape: part.kind === "track" ? "track" : "tyre" };
  }
  if (part.category === "weapon") {
    const rotating = rotorPlan(part, face);
    if (rotating) return rotating;
    switch (part.type) {
      case "flipper": return { shape: "flipper" };
      case "lifter": return { shape: "lifter" };
      case "hammer": return { shape: "hammer" };
      case "spear":
      case "drill": return { shape: "spear" };
      case "crusher": return { shape: "crusher" };
      case "flame": return { shape: "flame" };
      case "wedge": return { shape: "wedge" };
      case "fork": return { shape: "fork" };
      case "spike": return { shape: "spike" };
      default: return { shape: "plate" };
    }
  }
  if (part.category === "utility") return { shape: "utility" };
  if (part.type === "wedge") return { shape: "wedge" };
  return { shape: "plate" };
}
