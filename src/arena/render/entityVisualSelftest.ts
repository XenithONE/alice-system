/**
 * Gate: what the player sees is the thing that is actually there.
 *
 * Deployed traps are the first objects in this game drawn purely from a host
 * transform, and nothing else checks them. The failure they invite is quiet:
 * the pad is drawn at one radius and the collider built at another, so the
 * player reads the floor correctly and is punished anyway. That is worse than
 * an invisible trap, because it trains the wrong instinct.
 *
 * Neither side of the comparison is allowed to be the same expression twice.
 * The physics radius is read back out of Rapier's own shape after the collider
 * exists; the drawn radius is measured from the three.js bounding box of the
 * mesh the renderer would actually add to the scene. A shared constant is not
 * evidence that two systems agree — only two independent measurements are.
 */

/*
 * industrialKit paints its textures on a 2D canvas, which Node does not have.
 * The gate measures geometry, never pixels, so a canvas that accepts every
 * call and draws nothing is enough — and keeps the gate running on the real
 * createEntityVisual instead of a stripped-down copy of it.
 */
const gradientStub = { addColorStop: () => undefined };
const noopContext = new Proxy({} as CanvasRenderingContext2D, {
  get: (_target, key) => {
    if (key === "canvas") return { width: 0, height: 0 };
    if (key === "createImageData" || key === "getImageData") {
      return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
    }
    // Anything that builds a paint object has to return something chainable,
    // or the first .addColorStop takes the gate down for the wrong reason.
    return () => gradientStub;
  },
  set: () => true
});
(globalThis as { document?: unknown }).document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => noopContext })
};

import * as THREE from "three";
import type { EntSnap } from "../net/protocol";
import type { TrapKind } from "../sim/types";
import type { WeaponRuntime } from "../sim/assemble";
import { DEPLOY_PAD_HALF_HEIGHT } from "../sim/balance";
import { createMechanismHarness } from "../sim/mechanismSelftestHarness";
import { arenaSimTestHooks } from "../sim/world";
import { BOT_COLORS, createEntityVisual } from "./deployKit";

declare const process: { exitCode?: number; argv: string[] };

const TOLERANCE_M = 0.001;
const KIND_INDEX: Record<TrapKind, number> = { caltrop: 0, mine: 1, oil: 2, glue: 3 };

const rows: Record<string, unknown>[] = [];
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (!ok) failures.push(name);
};

/** Outer radius and floor clearance of a visual, measured from its geometry. */
function measure(root: THREE.Object3D): { radius: number; bottom: number; meshes: number } {
  root.updateMatrixWorld(true);
  let radius = 0;
  let bottom = Number.POSITIVE_INFINITY;
  let meshes = 0;
  const vertex = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, index);
      object.localToWorld(vertex);
      radius = Math.max(radius, Math.hypot(vertex.x - root.position.x, vertex.z - root.position.z));
      bottom = Math.min(bottom, vertex.y);
    }
  });
  return { radius, bottom, meshes };
}

async function main(): Promise<void> {
  const sabotage = process.argv.includes("--sabotage");
  const { sim } = await createMechanismHarness();
  const hooks = arenaSimTestHooks(sim);
  if (!hooks) throw new Error("missing test hooks");

  for (const kind of Object.keys(KIND_INDEX) as TrapKind[]) {
    // One seat per kind: DEPLOY_MIN_SPACING refuses a second trap from the
    // same owner at the same spot, and these bots never move.
    const seat = KIND_INDEX[kind];
    const bot = hooks.bots[seat]!;
    const source = bot.assembled.weapons[0];
    if (!source) throw new Error(`seat ${seat} has no weapon`);
    const weapon = {
      ...source,
      idx: 800 + KIND_INDEX[kind],
      def: { ...source.def, effect: "deploy", trapKind: kind, ammo: 9, cooldown: 0 },
      cooldownLeft: 0,
      ammoLeft: 9
    } as unknown as WeaponRuntime;

    if (!hooks.deploy.deploy(bot, weapon)) throw new Error(`${kind}: deploy refused`);
    const entity = hooks.deploy.entities().at(-1);
    if (!entity) throw new Error(`${kind}: no entity after deploy`);

    // Physics side: ask Rapier what shape it is holding, not what we asked for.
    const collider = hooks.world
      .getCollider(
        hooks.deploy
          .diagnostics()
          .colliderHandles.at(-1)!
      );
    const shape = collider.shape as unknown as { radius: number; halfHeight: number };
    const physicsRadius = shape.radius;
    const physicsBottom = collider.translation().y - shape.halfHeight;

    // Render side: build the visual the scene would receive and measure it.
    const snap: EntSnap = {
      i: entity.id,
      k: KIND_INDEX[kind] * 4 + seat,
      x: entity.x,
      y: sabotage ? entity.y + 0.05 : entity.y,
      z: entity.z,
      r: entity.yaw,
      s: 0
    };
    const visual = createEntityVisual(snap);
    const drawn = measure(visual.root);

    const radiusError = Math.abs(drawn.radius - physicsRadius);
    const bottomError = Math.abs(drawn.bottom - physicsBottom);
    rows.push({
      trap: kind,
      physicsRadius: +physicsRadius.toFixed(4),
      drawnRadius: +drawn.radius.toFixed(4),
      radiusErrMm: +(radiusError * 1000).toFixed(2),
      floorGapMm: +(drawn.bottom * 1000).toFixed(2),
      bottomErrMm: +(bottomError * 1000).toFixed(2),
      meshes: drawn.meshes
    });
    check(`${kind}-radius-matches-collider`, radiusError <= TOLERANCE_M);
    check(`${kind}-sits-on-floor`, bottomError <= TOLERANCE_M);
    check(`${kind}-not-below-floor`, drawn.bottom >= -TOLERANCE_M);
    check(`${kind}-has-geometry`, drawn.meshes >= 1);
  }

  // Projectiles have no collider pad to match, but they must exist, carry the
  // owner's colour, and never be silently empty.
  /*
   * industrialMaterial puts the tint in the texture and leaves `color` white,
   * so reading material.color proves nothing. What does prove the owner
   * reached the material is texture identity: the cache is keyed by colour, so
   * four seats must yield four distinct maps, and a seat must yield the same
   * map twice. That holds whether the tint lives in the map or the colour.
   */
  for (let kind = 4; kind <= 5; kind += 1) {
    const mapsBySeat = new Map<number, unknown>();
    for (let owner = 0; owner < 4; owner += 1) {
      const build = (): THREE.Object3D =>
        createEntityVisual({
          i: kind * 10 + owner, k: kind * 4 + owner, x: 0, y: 0.4, z: 0, r: 0, s: 0
        }).root;
      const root = build();
      const { meshes } = measure(root);
      check(`projectile-${kind}-${owner}-has-geometry`, meshes >= 1);

      let tint: unknown = null;
      root.traverse((object) => {
        if (tint === null && object instanceof THREE.Mesh) {
          const material = object.material as THREE.MeshStandardMaterial;
          tint = material.map ?? material.color.getHex();
        }
      });
      check(`projectile-${kind}-${owner}-has-tint`, tint !== null);
      mapsBySeat.set(owner, tint);

      // Same seat, built again: the tint must be the same object, not a new one.
      let repeat: unknown = null;
      build().traverse((object) => {
        if (repeat === null && object instanceof THREE.Mesh) {
          const material = object.material as THREE.MeshStandardMaterial;
          repeat = material.map ?? material.color.getHex();
        }
      });
      check(`projectile-${kind}-${owner}-tint-is-stable`, repeat === tint);
    }
    check(`projectile-${kind}-four-distinct-owner-tints`, new Set(mapsBySeat.values()).size === 4);
  }
  check("bot-colours-are-distinct", new Set(BOT_COLORS).size === 4);

  console.table(rows);
  console.log("PAD HALF HEIGHT", DEPLOY_PAD_HALF_HEIGHT, "TOLERANCE mm", TOLERANCE_M * 1000);
  if (failures.length > 0) {
    console.log("G-ENTITY-VISUAL FAIL", failures);
    process.exitCode = 1;
    return;
  }
  console.log("G-ENTITY-VISUAL PASS");
}

main().catch((error) => {
  console.log("G-ENTITY-VISUAL FAIL:", error);
  process.exitCode = 1;
});
