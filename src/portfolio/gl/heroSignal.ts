// Lightweight hero animation — Canvas 2D only.
// Deliberately not three.js: the portfolio entry is gated against three.module
// in scripts/measure_closure.mjs so the top page stays under the JS budget.

export interface HeroSignalHandle {
  dispose: () => void;
}

export function createHeroSignal(canvas: HTMLCanvasElement): HeroSignalHandle {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dispose: () => undefined };
  }

  let disposed = false;
  let raf = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;

  type Star = { x: number; y: number; r: number; a: number; s: number };
  type Node = { x: number; y: number; phase: number; amber: boolean };
  let stars: Star[] = [];
  let nodes: Node[] = [];
  let links: [number, number][] = [];

  const rebuild = (): void => {
    const parent = canvas.parentElement;
    w = parent?.clientWidth || window.innerWidth;
    h = parent?.clientHeight || window.innerHeight;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.4 + Math.random() * 1.4,
      a: 0.2 + Math.random() * 0.55,
      s: 0.15 + Math.random() * 0.45,
    }));

    const cx = w * 0.68;
    const cy = h * 0.48;
    const R = Math.min(w, h) * 0.22;
    nodes = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      const r = R * (0.55 + (i % 5) * 0.1);
      return {
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a * 1.35) * r * 0.72,
        phase: i * 0.35,
        amber: i % 5 === 0,
      };
    });
    links = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i]!.x - nodes[j]!.x;
        const dy = nodes[i]!.y - nodes[j]!.y;
        if (Math.hypot(dx, dy) < R * 0.72) links.push([i, j]);
      }
    }
  };

  rebuild();
  const ro = new ResizeObserver(rebuild);
  if (canvas.parentElement) ro.observe(canvas.parentElement);

  const draw = (now: number): void => {
    if (disposed) return;
    raf = window.requestAnimationFrame(draw);
    const t = now * 0.001;
    ctx.clearRect(0, 0, w, h);

    // soft radial glow
    const g = ctx.createRadialGradient(w * 0.68, h * 0.48, 10, w * 0.68, h * 0.48, Math.min(w, h) * 0.45);
    g.addColorStop(0, "rgba(230, 173, 70, 0.16)");
    g.addColorStop(0.45, "rgba(8, 169, 197, 0.06)");
    g.addColorStop(1, "rgba(6, 28, 49, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // stars
    for (const s of stars) {
      const tw = reduced ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * s.s + s.x));
      ctx.beginPath();
      ctx.fillStyle = `rgba(246, 241, 231, ${tw})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // links
    ctx.lineWidth = 1;
    for (const [i, j] of links) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      ctx.strokeStyle = "rgba(230, 173, 70, 0.22)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // core icosa-ish diamond
    const cx = w * 0.68;
    const cy = h * 0.48 + (reduced ? 0 : Math.sin(t * 0.9) * 6);
    const spin = reduced ? 0 : t * 0.35;
    const rad = Math.min(w, h) * 0.085;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    // outer ring
    ctx.strokeStyle = "rgba(230, 173, 70, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, rad * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(8, 169, 197, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, rad * 1.95, rad * 0.55, Math.PI / 5, 0, Math.PI * 2);
    ctx.stroke();

    // solid core
    const core = ctx.createRadialGradient(0, 0, 2, 0, 0, rad);
    core.addColorStop(0, "rgba(230, 173, 70, 0.55)");
    core.addColorStop(0.45, "rgba(10, 41, 68, 0.95)");
    core.addColorStop(1, "rgba(6, 28, 49, 0.2)");
    ctx.fillStyle = core;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(230, 173, 70, 0.45)";
    ctx.stroke();

    // wireframe
    ctx.strokeStyle = "rgba(230, 173, 70, 0.28)";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      ctx.stroke();
    }
    ctx.restore();

    // constellation nodes
    for (const n of nodes) {
      const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(t * 1.4 + n.phase);
      const r = (n.amber ? 2.6 : 1.8) * pulse;
      ctx.beginPath();
      ctx.fillStyle = n.amber ? "rgba(230, 173, 70, 0.95)" : "rgba(185, 197, 206, 0.85)";
      ctx.shadowColor = n.amber ? "rgba(230, 173, 70, 0.8)" : "rgba(23, 103, 170, 0.5)";
      ctx.shadowBlur = n.amber ? 10 : 4;
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  };

  raf = window.requestAnimationFrame(draw);

  return {
    dispose: () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
