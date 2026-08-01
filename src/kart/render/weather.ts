/**
 * Weather as a pure adjustment of the theme — one substitution point in the
 * scene, no scattered `if (rain)` branches.
 */

import type { TrackTheme } from "../sim/track";
import type { WeatherKind } from "../sim/balance";

export interface WeatherLook {
  readonly theme: TrackTheme;
  readonly rain: boolean;
  /** Wet tarmac: lower roughness, stronger reflections. */
  readonly roadRoughness: number;
  readonly roadEnvIntensity: number;
}

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) | (g << 8) | b;
}

export function resolveWeatherLook(
  theme: TrackTheme,
  weather: WeatherKind,
): WeatherLook {
  if (weather !== "rain") {
    return { theme, rain: false, roadRoughness: 0.87, roadEnvIntensity: 1 };
  }
  return {
    theme: {
      ...theme,
      fogDensity: theme.fogDensity * 1.9,
      fog: darken(theme.fog, 0.75),
      skyLow: darken(theme.skyLow, 0.72),
      skyHigh: darken(theme.skyHigh, 0.8),
      sunIntensity: theme.sunIntensity * 0.55,
      ambient: theme.ambient * 0.85,
      stars: 0,
    },
    rain: true,
    roadRoughness: 0.42,
    roadEnvIntensity: 1.6,
  };
}
