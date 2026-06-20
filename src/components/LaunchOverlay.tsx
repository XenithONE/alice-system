import { useEffect, useRef } from "react";
import { publicHomePath, routePath, type World } from "../data/worlds";

interface LaunchOverlayProps {
  world: World | null;
  onClose: () => void;
}

export function LaunchOverlay({ world, onClose }: LaunchOverlayProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!world) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [world, onClose]);

  if (!world?.url) return null;

  const src = routePath(world.url);

  function checkReturnNavigation(): void {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const loc = frame.contentWindow?.location;
      if (!loc) return;
      const home = new URL(publicHomePath(), window.location.origin);
      if (loc.pathname === home.pathname || loc.pathname.endsWith("/index.html")) {
        onClose();
      }
    } catch {
      // Same-origin pages are inspectable; this keeps remote failures harmless.
    }
  }

  async function enterFullscreen(): Promise<void> {
    const target = shellRef.current;
    if (!target || !target.requestFullscreen) return;
    await target.requestFullscreen();
  }

  return (
    <div className="launch-overlay" ref={shellRef} role="dialog" aria-modal="true" aria-label={`${world.title} launch overlay`}>
      <div className="launch-top">
        <div>
          <span>{world.kind === "app" ? "APP LINK" : "PLANET LINK"}</span>
          <strong>{world.title}</strong>
        </div>
        <div className="launch-actions">
          <button type="button" onClick={enterFullscreen}>
            FULL
          </button>
          <a href={src} target="_blank" rel="noreferrer">
            OPEN
          </a>
          <button type="button" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </div>
      <iframe ref={frameRef} key={world.id} title={world.title} src={src} onLoad={checkReturnNavigation} allow="fullscreen; autoplay; gamepad; clipboard-write" />
    </div>
  );
}
