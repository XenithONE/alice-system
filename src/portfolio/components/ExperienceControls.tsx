import { useEffect, useState } from "react";

export type ExperienceQuality = "auto" | "low" | "high";

interface ExperienceState {
  threeDEnabled: boolean;
  quality: ExperienceQuality;
  setThreeDEnabled: (enabled: boolean) => void;
  setQuality: (quality: ExperienceQuality) => void;
}

interface ExperienceControlsProps {
  threeDEnabled: boolean;
  quality: ExperienceQuality;
  onThreeDChange: (enabled: boolean) => void;
  onQualityChange: (quality: ExperienceQuality) => void;
}

const QUALITY_OPTIONS: ReadonlyArray<{ value: ExperienceQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" }
];

function readInitialThreeD(): boolean {
  if (typeof window === "undefined") return true;
  return new URLSearchParams(window.location.search).get("three") !== "off";
}

function readInitialQuality(): ExperienceQuality {
  if (typeof window === "undefined") return "auto";
  const quality = new URLSearchParams(window.location.search).get("q");
  return quality === "low" || quality === "high" ? quality : "auto";
}

export function useExperienceSettings(): ExperienceState {
  const [threeDEnabled, setThreeDEnabled] = useState(readInitialThreeD);
  const [quality, setQualityState] = useState<ExperienceQuality>(readInitialQuality);

  const setQuality = (nextQuality: ExperienceQuality): void => {
    // `?q=` is reserved for deterministic QA. Once a visitor chooses a visible
    // preference, the DOM setting takes over. Motion preferences still soften
    // animation, while the 3D composition itself remains visible by default.
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
    setQualityState(nextQuality);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("experience-3d-off", !threeDEnabled);
    root.dataset.experienceThree = threeDEnabled ? "on" : "off";
    root.dataset.experienceQuality = quality;

    const canvas = document.querySelector<HTMLCanvasElement>(".gl-canvas");
    if (canvas) canvas.hidden = !threeDEnabled;

    const url = new URL(window.location.href);
    if (threeDEnabled) {
      url.searchParams.delete("three");
    } else {
      url.searchParams.set("three", "off");
    }

    window.history.replaceState(window.history.state, "", url);

    window.dispatchEvent(
      new CustomEvent("alice:experience-change", {
        detail: { threeDEnabled, quality }
      })
    );
  }, [quality, threeDEnabled]);

  return { threeDEnabled, quality, setThreeDEnabled, setQuality };
}

export function ExperienceControls({
  threeDEnabled,
  quality,
  onThreeDChange,
  onQualityChange
}: ExperienceControlsProps) {
  return (
    <aside className="experience-controls" aria-label="3D表示設定">
      <details className="experience-menu">
        <summary>
          <span>3D</span>
          <strong>{threeDEnabled ? "ON" : "OFF"}</strong>
          <small>{quality.toUpperCase()}</small>
        </summary>
        <div className="experience-panel">
          <button
            className="experience-3d-toggle"
            type="button"
            aria-pressed={threeDEnabled}
            onClick={() => onThreeDChange(!threeDEnabled)}
          >
            <span>3D RENDERING</span>
            <strong>{threeDEnabled ? "ON" : "OFF"}</strong>
          </button>

          <fieldset className="experience-quality">
            <legend>QUALITY</legend>
            <div className="experience-quality-options">
              {QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={quality === option.value}
                  onClick={() => onQualityChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </aside>
  );
}
