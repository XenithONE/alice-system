import {
  BoxGeometry,
  Color,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer
} from "three/webgpu";
import type { GpuHooks, GpuWorld } from "../../gpu/GpuRoot";
import { FrameClock } from "../../gpu/perf";
import { disposeTree } from "../../gpu/dispose";
import {
  ROOM,
  activeIndexAt,
  cameraAt,
  corridor,
  progressForExhibit,
  tForProgress,
  verticalFov
} from "../curve";
import { EXHIBITS } from "../exhibits";
import { PANEL, buildShell, panelPlacements } from "./corridor";
import { buildPlates } from "./plates";
import { buildPipeline } from "./post";
import { ACTIVE_EVENT, HOVER_EVENT, emitIndex } from "../channel";

/**
 * The corridor, live.
 *
 * ── the scroll is the input, and nothing else is ─────────────────────────
 *
 * There is no wheel listener here, no preventDefault, and no smoothing
 * library. The document is tall because the DOM catalogue is tall; the browser
 * scrolls it the way the browser scrolls anything; this reads how far through
 * the list the viewport's middle has got and stands the camera there. Every
 * behaviour that comes with that — the scrollbar, PageDown, Home and End,
 * find-in-page, restoring the position on reload, a trackpad's own inertia —
 * is inherited rather than reimplemented, and none of it can be got subtly
 * wrong because none of it is written down.
 *
 * The only smoothing is a frame-rate-independent approach to the scroll's own
 * value, so a mouse wheel's discrete 100px steps become a walk rather than a
 * series of jumps.
 */

/** How quickly the camera catches up to the scroll. Seconds to ~63%. */
const EASE_TAU = 0.14;
/** Pixel ratio ceiling. Past this the fragment cost buys nothing on a wall. */
const MAX_DPR = 1.75;

export interface GalleryDebugState {
  readonly progress: number;
  readonly t: number;
  readonly metres: number;
  readonly active: number;
  readonly activeId: string;
  readonly camera: { x: number; y: number; z: number };
  readonly fovDeg: number;
  readonly aspect: number;
  readonly hovered: number;
  /** GPU bytes currently held by the seventeen covers. */
  readonly textureBytes: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
}

declare global {
  interface Window {
    __gallery?: {
      advance(deltaMs: number): Promise<void>;
      seek(progress: number): void;
      release(): void;
      getDebugState(): GalleryDebugState;
    };
  }
}

export async function createGalleryWorld(canvas: HTMLCanvasElement, hooks: GpuHooks): Promise<GpuWorld> {
  const count = EXHIBITS.length;
  const road = corridor();

  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  /*
   * three's default onDeviceLost logs and returns, which leaves the animation
   * loop submitting work to a dead device forever. There is no "restored"
   * event to wait for on this backend, so the only correct response is to stop
   * and tell the page.
   */
  renderer.onDeviceLost = (info) => {
    hooks.onDeviceLost(String((info as { message?: string }).message ?? "GPU デバイスが失われました"));
  };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  await renderer.init();

  const scene = new Scene();
  const wall = new Color("#eceef1");
  scene.background = wall;
  /* Haze, not a wall at the end. The corridor bends out of sight anyway; the
     fog is what stops the far end reading as a hole cut in the world. */
  scene.fog = new Fog(wall, 16, 64);

  const camera = new PerspectiveCamera(50, 1, 0.1, 140);

  /* ── surfaces ─────────────────────────────────────────────────────────── */
  const shell = buildShell(road);
  const room = new Group();
  const plaster = new MeshStandardNodeMaterial({ color: "#f4f5f7", roughness: 0.94, metalness: 0 });
  const stone = new MeshStandardNodeMaterial({ color: "#d9dade", roughness: 0.82, metalness: 0 });
  const soffit = new MeshStandardNodeMaterial({ color: "#fbfbfc", roughness: 0.98, metalness: 0 });
  room.add(new Mesh(shell.floor, stone));
  room.add(new Mesh(shell.ceiling, soffit));
  room.add(new Mesh(shell.leftWall, plaster));
  room.add(new Mesh(shell.rightWall, plaster));
  scene.add(room);

  /* ── panels ───────────────────────────────────────────────────────────── */
  /*
   * One geometry, seventeen meshes. Every panel is the same slab, so sharing
   * the BufferGeometry is 16 vertex buffers not allocated — and it is why
   * disposeTree has to be told about shared resources rather than walking the
   * tree and calling dispose seventeen times on the same object.
   */
  const placements = panelPlacements(count, road);
  const slab = new BoxGeometry(1, 1, PANEL.depth);
  const board = new MeshStandardNodeMaterial({ color: "#fdfdfd", roughness: 0.7, metalness: 0 });
  const panels = new Group();
  for (const place of placements) {
    const mesh = new Mesh(slab, board);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(place.matrix);
    mesh.matrix.scale(new Vector3(place.width, place.height, 1));
    mesh.matrixWorldNeedsUpdate = true;
    panels.add(mesh);
  }
  scene.add(panels);

  /* The works, at whichever resolution the reader is close enough to deserve. */
  const art = new Group();
  scene.add(art);
  const plates = buildPlates(placements, import.meta.env.BASE_URL, art);

  /* ── light ────────────────────────────────────────────────────────────── */
  /*
   * Three lamps that walk with the reader rather than seventeen that do not.
   * A gallery is lit at the pictures, and the only pictures that matter are
   * the ones being looked at; parking the lamps on the active plate and its
   * neighbours costs three lights instead of seventeen and is brighter
   * exactly where the reader is.
   */
    /*
   * Dimmer than a lit room, brighter than a dark one.
   *
   * The first pass ran the ambient at 1.15 and the corridor came out evenly
   * bright — which read as a diagram, hid the lamps entirely, and made two
   * hundred thousand additive dust motes literally invisible: white on white
   * adds nothing. A gallery is pools of light with the space between them
   * falling away, and that is also the only lighting in which airborne dust
   * exists at all.
   */
  scene.add(new HemisphereLight("#fdfbf5", "#aab0b8", 0.62));
  const lamps = [0, 1, 2].map(() => {
    const light = new PointLight("#fff2dc", 58, 22, 2);
    scene.add(light);
    return light;
  });
  /* Scratch vectors, reused every frame. Allocating three Vector3 sixty times
     a second is how a scene that runs fine for a minute starts hitching. */
  const facing = new Vector3();
  const lampAt = new Vector3();

  /*
   * ── what is deliberately NOT here: the compute dust ────────────────────
   *
   * Two hundred thousand motes on a TSL compute dispatch were built, wired and
   * measured. They never appeared. Two destructive controls settled it in the
   * same session: painting them opaque red drew nothing, and putting their real
   * world positions straight into the vertex attribute — bypassing the storage
   * buffer entirely — also drew nothing. So the failure is the Points +
   * PointsNodeMaterial path in this build, not the compute and not the buffer.
   *
   * Kept out rather than left in as a dispatch nobody can see: 200,000 elements
   * of compute and 7 MB of buffers every frame, producing no pixels, is worse
   * than not having the feature. The depth of field below is the WebGPU
   * justification and it is one that can be pointed at on screen.
   */

  /* Depth of field, and with it the whole render path: from here on the scene
     is drawn through the pipeline, never straight to the canvas. */
  const pipeline = buildPipeline(renderer, scene, camera);

  /* ── the scroll, measured once per layout change ──────────────────────── */
  let listTop = 0;
  let listHeight = 1;
  const list = document.querySelector<HTMLElement>(".cg-list");
  const measure = (): void => {
    if (!list) return;
    const rect = list.getBoundingClientRect();
    listTop = rect.top + window.scrollY;
    listHeight = Math.max(1, rect.height);
  };
  /*
   * A ResizeObserver rather than a resize listener, because the list's height
   * changes without the window doing anything: adding html.cg-live turns every
   * row from auto-height into a fixed slab, and that happens AFTER this
   * function returns. Reading the height once at boot would map the whole
   * corridor onto the catalogue's height and put the reader at the far end
   * before they had scrolled a screen.
   */
  const listObserver = new ResizeObserver(measure);
  if (list) listObserver.observe(list);
  measure();

  const readScroll = (): number => {
    const middle = window.scrollY + window.innerHeight * 0.5;
    return Math.min(Math.max((middle - listTop) / listHeight, 0), 1);
  };

  /* ── state ────────────────────────────────────────────────────────────── */
  let progress = readScroll();
  let target = progress;
  let override: number | null = null;
  let announced = -1;
  const clock = new FrameClock();
  let last = performance.now();

  const place = (): void => {
    const t = tForProgress(progress, count, road);
    const pose = cameraAt(t, road);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);

    const active = activeIndexAt(t, count, road);
    if (active !== announced) {
      announced = active;
      /* Once per change, not once per frame: the caption rail is React state
         and a sixty-a-second event would re-render the page continuously for
         a string that changes every four seconds. */
      plates.focus(active);
      emitIndex(ACTIVE_EVENT, active);
    }
    /* The lamp at the active plate, and one either side, so a plate is already
       lit by the time it comes round the bend. */
    lamps.forEach((lamp, i) => {
      const index = Math.min(count - 1, Math.max(0, active + i - 1));
      const p = placements[index]!;
      lampAt.setFromMatrixPosition(p.matrix);
      /*
       * In FRONT of the panel and above it, which is where a gallery puts a
       * spot. Directly overhead — the first attempt — grazes the face at
       * almost ninety degrees and lights the ceiling instead: the render came
       * back with beautiful pools of light on the soffit and every picture in
       * shadow. The panel's own normal is the third basis column of its
       * matrix, so the offset follows the toe rather than assuming a wall.
       */
      facing.setFromMatrixColumn(p.matrix, 2);
      lamp.position.copy(lampAt).addScaledVector(facing, 1.8);
      lamp.position.y += 1.35;
    });

    /*
     * Focus follows the frame the reader is walking toward, so approaching a
     * picture racks focus onto it. Measured to the plate the camera is heading
     * for rather than the one it is level with — by the time a plate is beside
     * you it is not what you are looking at.
     */
    const ahead = placements[Math.min(count - 1, active)]!;
    lampAt.setFromMatrixPosition(ahead.matrix);
    pipeline.set(camera.position.distanceTo(lampAt));
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    const aspect = width / height;
    camera.aspect = aspect;
    camera.fov = (verticalFov(aspect) * 180) / Math.PI;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    measure();
  };
  window.addEventListener("resize", resize, { passive: true });
  resize();

  /* ── picking ──────────────────────────────────────────────────────────── */
  /*
   * The mouse route into a work. The keyboard route is the DOM list, which is
   * still there under the canvas and still holds seventeen real links — the
   * two meet at the same href rather than at a shared handler, so neither can
   * be the one that is subtly out of date.
   *
   * Raycast once per frame against seventeen quads, using the last pointer
   * position, rather than on every pointermove. A trackpad emits a few hundred
   * moves a second and each one would otherwise cost a full traversal.
   */
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let pointerInside = false;
  let hovered = -1;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    pointerInside = true;
  };
  const onPointerLeave = (): void => {
    pointerInside = false;
  };
  const onClick = (): void => {
    const work = hovered >= 0 ? EXHIBITS[hovered] : undefined;
    if (!work) return;
    /* The catalogue row's href, resolved the same way the row resolves it. */
    window.location.href = import.meta.env.BASE_URL + work.href;
  };
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
  canvas.addEventListener("click", onClick);

  const pick = (): void => {
    let next = -1;
    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(plates.targets as Mesh[], false)[0];
      if (hit) next = (hit.object.userData.exhibit as number) ?? -1;
    }
    if (next === hovered) return;
    hovered = next;
    canvas.style.cursor = hovered >= 0 ? "pointer" : "";
    emitIndex(HOVER_EVENT, hovered);
  };

  const step = (deltaMs: number): void => {
    const dt = Math.min(deltaMs, 100) / 1000;
    target = override ?? readScroll();
    /* 1 - exp(-dt/tau), so the approach is the same shape at 30 fps and 144. A
       plain lerp factor would make the camera lag more on a slow machine — the
       machine that could least afford to feel sluggish. */
    progress += (target - progress) * (1 - Math.exp(-dt / EASE_TAU));
    place();
    pick();
  };

  const render = async (): Promise<void> => {
    pipeline.render();
  };

  /*
   * setAnimationLoop returns a promise on this backend. An unhandled rejection
   * in it does not throw anywhere visible — the loop simply stops and the last
   * frame stays on screen, which reads as "the page froze" with nothing in the
   * console.
   */
  void renderer
    .setAnimationLoop((time) => {
      const delta = time - last;
      last = time;
      clock.push(delta);
      step(delta);
      pipeline.render();
    })
    .catch((error) => {
      if (import.meta.env.DEV) console.warn("Gallery loop stopped.", error);
      hooks.onDeviceLost("描画ループが停止しました");
    });

  /* ── the seam the tests drive ─────────────────────────────────────────── */
  /*
   * The in-app browser reports document.hidden === true, so requestAnimationFrame
   * never fires there and setAnimationLoop never runs. Without this, nothing
   * about the corridor could be checked automatically at all — not one frame,
   * not one camera position. It is added here rather than bolted on later
   * because a seam retrofitted after the fact tests the code that was written
   * around it.
   */
  window.__gallery = {
    advance: async (deltaMs: number) => {
      step(deltaMs);
      clock.push(deltaMs);
      await render();
    },
    seek: (p: number) => {
      override = Math.min(Math.max(p, 0), 1);
      progress = override;
      place();
    },
    release: () => {
      override = null;
    },
    getDebugState: () => {
      const t = tForProgress(progress, count, road);
      const active = activeIndexAt(t, count, road);
      const stats = clock.stats();
      return {
        progress,
        t,
        metres: t * road.length,
        active,
        activeId: EXHIBITS[active]?.id ?? "",
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        fovDeg: camera.fov,
        aspect: camera.aspect,
        hovered,
        textureBytes: plates.bytes(),
        drawCalls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        frames: stats.frames,
        p50: stats.p50,
        p95: stats.p95,
        worst: stats.worst
      };
    }
  };

  /* Standing at the reader's actual scroll position before the first frame,
     so arriving mid-page does not start at the entrance and fly. */
  place();
  await render();

  return {
    dispose() {
      void renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      canvas.style.cursor = "";
      listObserver.disconnect();
      if (window.__gallery) delete window.__gallery;
      /* Textures and the shared plane first: disposeTree walks the graph and
         would call dispose on the one shared PlaneGeometry seventeen times
         while missing the maps it never had a reference to. */
      pipeline.dispose();
      plates.dispose();
      disposeTree(scene);
      /* Shared between every panel, so the tree walk above disposed it once
         per mesh and would leave the others pointing at a freed buffer if it
         were not the same object. Named here so that stays deliberate. */
      slab.dispose();
      renderer.dispose();
    }
  };
}

/** Where the page should scroll to put a given work in front of the reader. */
export function scrollTopForExhibit(index: number, count: number): number {
  const list = document.querySelector<HTMLElement>(".cg-list");
  if (!list) return 0;
  const rect = list.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  return top + progressForExhibit(index, count) * rect.height - window.innerHeight * 0.5;
}

/** Metres of corridor, exported so the page can say how long the walk is. */
export const CORRIDOR_METRES = Math.round(corridor().length);

/** Eye height, so the caption rail can be written against the same number. */
export const EYE = ROOM.eye;
