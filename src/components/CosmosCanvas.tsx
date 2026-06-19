import { useEffect, useRef, useState } from "react";
import { WORLDS } from "../data/worlds";
import type { FragmentId, World } from "../data/worlds";
import { CosmosEngine, type CosmosInfo, type TimeTrialEvent } from "../lib/cosmosEngine";
import type { ProgressState } from "../lib/storage";
import { detectQuality, hasWebGL } from "../lib/webgl";

interface CosmosCanvasProps {
  progress: ProgressState;
  onSelectWorld: (world: World) => void;
  onNearestWorld: (world: World | null) => void;
  onCollectFragment: (fragment: FragmentId) => void;
  onRevealHiddenPlanet: () => void;
  onReady: (info: CosmosInfo) => void;
  onError: (message: string) => void;
  onCollectStardust: (id: string) => void;
  onFlyDistance: (units: number) => void;
  onTimeTrial: (event: TimeTrialEvent) => void;
  onEngine: (engine: CosmosEngine | null) => void;
}

export function CosmosCanvas({
  progress,
  onSelectWorld,
  onNearestWorld,
  onCollectFragment,
  onRevealHiddenPlanet,
  onReady,
  onError,
  onCollectStardust,
  onFlyDistance,
  onTimeTrial,
  onEngine
}: CosmosCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CosmosEngine | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [stageInfo, setStageInfo] = useState({ quality: "loading", spark: "loading", bloom: "loading", gravity: "loading", flare: "loading", rays: "loading" });

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!hasWebGL()) {
      setUnsupported(true);
      onError("WebGL is not available in this browser.");
      return;
    }

    const quality = detectQuality();
    setStageInfo({
      quality: quality.label.toLowerCase(),
      spark: quality.spark ? "on" : "off",
      bloom: quality.bloom ? "on" : "off",
      gravity: quality.label === "HIGH" && !quality.mobile && !quality.reducedMotion ? "on" : "off",
      flare: quality.label === "HIGH" && !quality.mobile ? "on" : "off",
      rays: quality.label === "HIGH" && !quality.mobile && !quality.reducedMotion ? "on" : "off"
    });

    const engine = new CosmosEngine(canvasRef.current, WORLDS, progress, quality, {
      onSelectWorld,
      onNearestWorld,
      onCollectFragment,
      onRevealHiddenPlanet,
      onReady,
      onError,
      onCollectStardust,
      onFlyDistance,
      onTimeTrial
    });
    engineRef.current = engine;
    onEngine(engine);

    return () => {
      engine.dispose();
      engineRef.current = null;
      onEngine(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.syncProgress(progress);
  }, [progress.version]);

  return (
    <div
      className="cosmos-stage"
      data-webgl={unsupported ? "unsupported" : "ready"}
      data-quality={stageInfo.quality}
      data-spark={stageInfo.spark}
      data-bloom={stageInfo.bloom}
      data-gravity={stageInfo.gravity}
      data-flare={stageInfo.flare}
      data-rays={stageInfo.rays}
    >
      <canvas ref={canvasRef} className="cosmos-canvas" />
    </div>
  );
}
