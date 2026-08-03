/*
 * The living ground — a raw WebGL2 fluid that sits at z:-1 under the whole
 * page and answers the pointer with SPECTRUM dye.
 *
 * Deliberately NOT three.js: the top page's closure is gated against
 * three.module in scripts/measure_closure.mjs, and a two-field advection
 * needs nothing a scene graph provides. Everything here is one context, two
 * ping-pong render-target pairs, three fragment programs and one rAF.
 *
 * Simulation shape (per frame):
 *   1. velocity ← advect(velocity by itself) + ambient curl + pointer force
 *   2. dye      ← advect(dye by velocity) · decay − ε + splat colour
 *   3. screen   ← screen-blend(dye over u_ground) + 1-bit dither
 * No pressure solve. Divergence-free flow buys turbulence we do not need for
 * an aurora/smoke look, and it would double the pass count.
 *
 * Lessons burned in from v2.1's fluid (the last time this site had one):
 *   - 8-bit multiplicative decay freezes at ~11/255 — subtract a linear ε
 *     after the multiply or trails ghost forever.
 *   - decay is pow(k, dt·60), never a bare per-frame constant: a 144 Hz
 *     display would otherwise fade 2.4× faster than the machine it was
 *     tuned on.
 *   - size from documentElement.clientWidth, not innerWidth — a classic
 *     scrollbar is ~17px of phantom canvas otherwise.
 */

export interface FluidLayerCallbacks {
  /** First successful frame — the canvas can fade in now. */
  onAlive: () => void;
  /** Permanently gone (watchdog floor or dispose) — restore the DOM ground. */
  onDead: () => void;
  /** GL context lost — the owner should dispose and re-boot when it suits. */
  onContextLost: () => void;
}

export interface FluidLayerHandle {
  dispose: () => void;
}

/* SPECTRUM anchors — the same three the CSS gradient uses. Kept as TS
 * constants: [C6] governs :root tokens, and a shader cannot read CSS vars. */
const SPECTRUM: ReadonlyArray<readonly [number, number, number]> = [
  [230 / 255, 173 / 255, 70 / 255], // amber
  [224 / 255, 81 / 255, 124 / 255], // magenta
  [8 / 255, 169 / 255, 197 / 255], // azure
];

const VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* Velocity is stored 0.5-biased in RG of an RGBA8 target. Coarse, but an
 * aurora does not need laminar precision — it needs cheap. */
const FRAG_VEL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_vel;
uniform float u_dt, u_time, u_decay, u_flow, u_ambient, u_ar;
uniform vec3 u_splat;   /* xy = uv pos, z = 1/radius^2 */
uniform vec2 u_force;
vec2 dec(vec4 t) { return (t.rg - 0.5) * 2.0; }
vec2 curl(vec2 p, float t) {
  float x = sin(p.y * 4.7 + t * 0.30) + sin(p.y * 2.3 - t * 0.17 + 1.7);
  float y = sin(p.x * 3.9 - t * 0.23 + 0.6) + sin(p.x * 1.7 + t * 0.13);
  return vec2(x, y) * 0.5;
}
void main() {
  vec2 here = dec(texture(u_vel, v_uv));
  vec2 v = dec(texture(u_vel, v_uv - here * u_dt * u_flow));
  v *= u_decay;
  v += curl(v_uv * vec2(u_ar, 1.0) * 2.0, u_time) * u_ambient * u_dt;
  vec2 d = (v_uv - u_splat.xy) * vec2(u_ar, 1.0);
  v += u_force * exp(-dot(d, d) * u_splat.z);
  /* deadzone: biased 8-bit storage cannot express a true crawl to zero */
  if (dot(v, v) < 0.000016) v = vec2(0.0);
  o = vec4(clamp(v, -1.0, 1.0) * 0.5 + 0.5, 0.0, 1.0);
}`;

const FRAG_DYE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_dye, u_vel;
uniform float u_dt, u_decay, u_eps, u_flow, u_ar;
uniform vec3 u_splat;
uniform vec3 u_color;
vec2 dec(vec4 t) { return (t.rg - 0.5) * 2.0; }
void main() {
  vec2 v = dec(texture(u_vel, v_uv));
  vec3 c = texture(u_dye, v_uv - v * u_dt * u_flow).rgb;
  /* multiplicative fade + linear epsilon so 8-bit actually reaches zero */
  c = max(vec3(0.0), c * u_decay - u_eps);
  vec2 d = (v_uv - u_splat.xy) * vec2(u_ar, 1.0);
  c += u_color * exp(-dot(d, d) * u_splat.z);
  o = vec4(c, 1.0);
}`;

const FRAG_SHOW = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_dye;
uniform vec3 u_ground;
uniform float u_time;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = texture(u_dye, v_uv).rgb;
  /* screen blend: glows on the dark issue, stays paper-plausible on the
     light one (the canvas is further dimmed by CSS there). */
  vec3 c = 1.0 - (1.0 - u_ground) * (1.0 - d);
  c += (hash(v_uv * 1913.0 + fract(u_time)) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createFluidLayer(
  canvas: HTMLCanvasElement,
  cb: FluidLayerCallbacks
): FluidLayerHandle | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  let disposed = false;
  let raf = 0;
  let alive = false;

  // ---------------------------------------------------------------- compile
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      // A driver that rejects these shaders is a driver we leave alone.
      console.warn("[fluid] shader compile failed:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const link = (frag: string): WebGLProgram | null => {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    if (!p) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn("[fluid] program link failed:", gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    return p;
  };

  const progVel = link(FRAG_VEL);
  const progDye = link(FRAG_DYE);
  const progShow = link(FRAG_SHOW);
  if (!progVel || !progDye || !progShow) return null;

  const U = (p: WebGLProgram, n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n);

  // Fullscreen triangle comes from gl_VertexID — an empty VAO is still needed
  // on strict drivers.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // ---------------------------------------------------------------- targets
  const makeTarget = (w: number, h: number): Target | null => {
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    // velocity's "no flow" is mid-grey; clearing to it avoids a first-frame kick
    gl.clearColor(0.5, 0.5, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fb, tex, w, h };
  };
  const freeTarget = (t: Target | null): void => {
    if (!t) return;
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
  };

  let vel0: Target | null = null;
  let vel1: Target | null = null;
  let dye0: Target | null = null;
  let dye1: Target | null = null;

  /* Watchdog rungs: 0 = full, 1 = dpr 1.0, 2 = dye halved. Below that we die. */
  let rung = 0;
  let dpr = 1;
  let cw = 1;
  let ch = 1;

  const sizeFor = (longest: number): [number, number] => {
    const ar = cw / Math.max(1, ch);
    return ar >= 1
      ? [longest, Math.max(16, Math.round(longest / ar))]
      : [Math.max(16, Math.round(longest * ar)), longest];
  };

  const rebuild = (): void => {
    // v2.1: clientWidth, not innerWidth — the scrollbar is not canvas.
    cw = document.documentElement.clientWidth || window.innerWidth;
    ch = document.documentElement.clientHeight || window.innerHeight;
    dpr = rung >= 1 ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));

    freeTarget(vel0); freeTarget(vel1); freeTarget(dye0); freeTarget(dye1);
    const [vw, vh] = sizeFor(192);
    const dyeLong = Math.min(rung >= 2 ? 360 : 720, Math.max(64, Math.floor(Math.max(cw, ch) / 2)));
    const [dw, dh] = sizeFor(dyeLong);
    vel0 = makeTarget(vw, vh);
    vel1 = makeTarget(vw, vh);
    dye0 = makeTarget(dw, dh);
    dye1 = makeTarget(dw, dh);
  };
  rebuild();
  if (!vel0 || !vel1 || !dye0 || !dye1) return null;

  const onResize = (): void => rebuild();
  window.addEventListener("resize", onResize);

  // ---------------------------------------------------------------- ground
  /* --bg, read from the computed style and pushed as a uniform. Watching
   * data-theme (its only writer is the THEME toggle) keeps this in step
   * without coupling the two features. */
  let ground: [number, number, number] = [6 / 255, 28 / 255, 49 / 255];
  const readGround = (): void => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(raw);
    if (!m) return;
    const n = parseInt(m[1]!, 16);
    ground = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  readGround();
  const themeWatch = new MutationObserver(readGround);
  themeWatch.observe(document.documentElement, { attributeFilter: ["data-theme"] });

  // ---------------------------------------------------------------- input
  /* Pointer state in uv space. Only the latest move matters per frame; the
   * force is consumed and zeroed after each simulation step. */
  let px = 0.5;
  let py = 0.5;
  let fx = 0;
  let fy = 0;
  let lastPointerAt = -1e9;
  const onPointer = (e: PointerEvent): void => {
    const nx = e.clientX / cw;
    const ny = 1 - e.clientY / ch;
    if (lastPointerAt > 0) {
      fx += (nx - px) * 14;
      fy += (ny - py) * 14;
    }
    px = nx;
    py = ny;
    lastPointerAt = performance.now() / 1000;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  /* Scroll feeds the ambient flow, not a splat: "stroking the page speeds the
   * weather". Cheap and it keeps wheel-only readers inside the effect. */
  let scrollBoost = 0;
  let lastScrollY = window.scrollY;
  const onScroll = (): void => {
    const dy = Math.abs(window.scrollY - lastScrollY);
    lastScrollY = window.scrollY;
    scrollBoost = Math.min(1.5, scrollBoost + dy / 900);
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---------------------------------------------------------------- pauses
  /* The paper leaves and the closing spread fully occlude z:-1. Polling two
   * rects every ~30 frames is cheaper than any observer bookkeeping. */
  const occluders = [".lab-notebook", ".site-footer"]
    .map((s) => document.querySelector(s))
    .filter((el): el is Element => el !== null);
  let occluded = false;
  let occlusionCheckIn = 0;
  const checkOcclusion = (): void => {
    occluded = occluders.some((el) => {
      const r = el.getBoundingClientRect();
      return r.top <= 2 && r.bottom >= ch - 2;
    });
  };

  let hidden = document.hidden;
  const onVisibility = (): void => {
    hidden = document.hidden;
    if (!hidden && !disposed) schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onLost = (e: Event): void => {
    e.preventDefault();
    window.cancelAnimationFrame(raf);
    cb.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  // ---------------------------------------------------------------- frame
  let last = performance.now();
  /* Watchdog: honest fps = N/Σdt over a 120-frame window (a 1/dt average is
   * harmonic-mean biased and cannot see jank — v4's ladder lesson). */
  let winDt = 0;
  let winN = 0;

  const draw = (fb: WebGLFramebuffer | null, w: number, h: number): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const step = (now: number): void => {
    if (disposed) return;
    raf = window.requestAnimationFrame(step);
    const rawDt = (now - last) / 1000;
    last = now;
    if (hidden) return;
    if (--occlusionCheckIn <= 0) {
      occlusionCheckIn = 30;
      checkOcclusion();
    }
    if (occluded) return;

    const dt = Math.min(0.033, Math.max(0.001, rawDt));
    const t = now / 1000;
    scrollBoost = Math.max(0, scrollBoost * Math.pow(0.2, dt));
    const flow = (0.9 + scrollBoost) * 0.06; /* uv/s cap — the sickness line */

    /* The ambient splat roams a slow lissajous when the pointer is idle, so
     * the field never dies; a live pointer takes the slot over. */
    const pointerFresh = t - lastPointerAt < 2.5;
    const sx = pointerFresh ? px : 0.5 + 0.34 * Math.sin(t * 0.11);
    const sy = pointerFresh ? py : 0.52 + 0.27 * Math.sin(t * 0.083 + 1.9);
    const speed = Math.hypot(fx, fy);
    const cycle = (t * 0.05 + speed * 0.35) % 1;
    const seg = cycle * 3;
    const a = SPECTRUM[Math.floor(seg) % 3]!;
    const b = SPECTRUM[(Math.floor(seg) + 1) % 3]!;
    const mix = seg - Math.floor(seg);
    const dyeAmount = pointerFresh ? Math.min(0.5, speed * 1.6) : 0.05 + 0.03 * Math.sin(t * 0.7);
    const color: [number, number, number] = [
      (a[0] + (b[0] - a[0]) * mix) * dyeAmount,
      (a[1] + (b[1] - a[1]) * mix) * dyeAmount,
      (a[2] + (b[2] - a[2]) * mix) * dyeAmount,
    ];
    const ar = cw / Math.max(1, ch);
    const radius = pointerFresh ? 1 / 0.004 : 1 / 0.02;

    // 1. velocity
    gl.useProgram(progVel);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vel0!.tex);
    gl.uniform1i(U(progVel, "u_vel"), 0);
    gl.uniform1f(U(progVel, "u_dt"), dt);
    gl.uniform1f(U(progVel, "u_time"), t);
    gl.uniform1f(U(progVel, "u_decay"), Math.pow(0.975, dt * 60));
    gl.uniform1f(U(progVel, "u_flow"), flow);
    gl.uniform1f(U(progVel, "u_ambient"), 0.55);
    gl.uniform1f(U(progVel, "u_ar"), ar);
    gl.uniform3f(U(progVel, "u_splat"), sx, sy, radius);
    gl.uniform2f(U(progVel, "u_force"), Math.max(-0.9, Math.min(0.9, fx)), Math.max(-0.9, Math.min(0.9, fy)));
    draw(vel1!.fb, vel1!.w, vel1!.h);
    [vel0, vel1] = [vel1, vel0];
    fx = 0;
    fy = 0;

    // 2. dye
    gl.useProgram(progDye);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dye0!.tex);
    gl.uniform1i(U(progDye, "u_dye"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, vel0!.tex);
    gl.uniform1i(U(progDye, "u_vel"), 1);
    gl.uniform1f(U(progDye, "u_dt"), dt);
    gl.uniform1f(U(progDye, "u_decay"), Math.pow(0.985, dt * 60));
    gl.uniform1f(U(progDye, "u_eps"), 0.75 / 255);
    gl.uniform1f(U(progDye, "u_flow"), flow);
    gl.uniform1f(U(progDye, "u_ar"), ar);
    gl.uniform3f(U(progDye, "u_splat"), sx, sy, radius);
    gl.uniform3f(U(progDye, "u_color"), color[0], color[1], color[2]);
    draw(dye1!.fb, dye1!.w, dye1!.h);
    [dye0, dye1] = [dye1, dye0];

    // 3. screen
    gl.useProgram(progShow);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dye0!.tex);
    gl.uniform1i(U(progShow, "u_dye"), 0);
    gl.uniform3f(U(progShow, "u_ground"), ground[0], ground[1], ground[2]);
    gl.uniform1f(U(progShow, "u_time"), t);
    draw(null, canvas.width, canvas.height);

    if (!alive) {
      alive = true;
      cb.onAlive();
    }

    // watchdog
    winDt += rawDt;
    winN += 1;
    if (winN >= 120) {
      const fps = winN / winDt;
      winDt = 0;
      winN = 0;
      if (fps < 24 && rung >= 2) {
        dispose();
        cb.onDead();
        return;
      }
      if (fps < 30 && rung < 2) {
        rung = 2;
        rebuild();
      } else if (fps < 40 && rung < 1) {
        rung = 1;
        rebuild();
      }
    }
  };

  const schedule = (): void => {
    window.cancelAnimationFrame(raf);
    last = performance.now();
    raf = window.requestAnimationFrame(step);
  };
  schedule();

  // ---------------------------------------------------------------- dispose
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onLost);
    themeWatch.disconnect();
    try {
      freeTarget(vel0); freeTarget(vel1); freeTarget(dye0); freeTarget(dye1);
      gl.deleteProgram(progVel);
      gl.deleteProgram(progDye);
      gl.deleteProgram(progShow);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* a lost context throws on cleanup calls — it is already clean */
    }
  };

  return { dispose };
}
