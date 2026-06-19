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

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!hasWebGL()) {
      setUnsupported(true);
      onError("WebGL is not available in this browser.");
      return;
    }

    const quality = detectQuality();

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
    <div className="cosmos-stage" data-webgl={unsupported ? "unsupported" : "ready"}>
      <canvas ref={canvasRef} className="cosmos-canvas" />
    </div>
  );
}
