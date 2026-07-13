import { useEffect, useRef } from "react";
import {
  HorrorEngine,
  type GameInfo,
  type GameMode,
  type HorrorPlayerPose,
  type HorrorWorldState,
  type JumpscareKind,
  type RunEndResult
} from "../lib/horrorEngine";
import { detectQuality } from "../lib/webgl";

interface GameCanvasProps {
  loop: number;
  onReady: (info: GameInfo) => void;
  onError: (message: string) => void;
  onFilesUpdate: (found: number, total: number) => void;
  onFear: (value: number) => void;
  onTime: (ms: number) => void;
  onJumpscare: (kind: JumpscareKind) => void;
  onHideChange: (hiding: boolean) => void;
  onFlashlightChange: (on: boolean) => void;
  onModeChange: (mode: GameMode) => void;
  onRunEnd: (result: RunEndResult) => void;
  onLocalPose: (pose: HorrorPlayerPose) => void;
  onAuthorityState: (state: HorrorWorldState) => void;
  onFileClaim: (fileId: number) => void;
  onEngine: (engine: HorrorEngine) => void;
}

export function GameCanvas(props: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const touchLayerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const touchLayer = touchLayerRef.current;
    if (!canvas || !touchLayer) return;

    const quality = detectQuality();
    let engine: HorrorEngine | null = null;
    try {
      engine = new HorrorEngine(canvas, touchLayer, quality, {
        onReady: (info) => propsRef.current.onReady(info),
        onError: (message) => propsRef.current.onError(message),
        onFilesUpdate: (found, total) => propsRef.current.onFilesUpdate(found, total),
        onFear: (value) => propsRef.current.onFear(value),
        onTime: (ms) => propsRef.current.onTime(ms),
        onJumpscare: (kind) => propsRef.current.onJumpscare(kind),
        onHideChange: (hiding) => propsRef.current.onHideChange(hiding),
        onFlashlightChange: (on) => propsRef.current.onFlashlightChange(on),
        onModeChange: (mode) => propsRef.current.onModeChange(mode),
        onRunEnd: (result) => propsRef.current.onRunEnd(result),
        onLocalPose: (pose) => propsRef.current.onLocalPose(pose),
        onAuthorityState: (state) => propsRef.current.onAuthorityState(state),
        onFileClaim: (fileId) => propsRef.current.onFileClaim(fileId)
      }, propsRef.current.loop);
      propsRef.current.onEngine(engine);
    } catch (err) {
      propsRef.current.onError(String(err));
    }

    return () => {
      engine?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="stage" />
      <div ref={touchLayerRef} className="touch-layer" aria-hidden="true" />
    </>
  );
}
