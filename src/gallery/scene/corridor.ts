import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from "three/webgpu";
import { PLATE, ROOM, corridor, exhibitPoses, type Corridor, type Vec3 } from "../curve";

/**
 * The room, built from frameAt() and nothing else.
 *
 * Every vertex here comes from the same function the camera stands on, the
 * picker hit-tests against and gallerySelftest measures. That is not tidiness:
 * SCRAP CROWN built its walls in one loop and its colliders in another, they
 * disagreed by 0.747 m at low detail, and players on weak machines walked
 * through a wall that was visibly in front of them. A second loop that "does
 * the same thing" is a second opinion, and two opinions is how a wall ends up
 * somewhere other than where it looks.
 *
 * ── winding ──────────────────────────────────────────────────────────────
 *
 * The reader is INSIDE this geometry, so every face points inward and getting
 * one wrong makes that surface invisible from the only place anyone stands.
 * Each strip therefore names its two rails in the order that makes
 * cross(rail-to-rail, direction-of-travel) point into the room, worked through
 * once per face below rather than fixed afterwards with side: DoubleSide —
 * which would hide the mistake and double the fragment cost.
 */

const RINGS = 640;
/** Metres of wall per texture repeat. Also the paced rhythm of the panelling. */
const TILE = 4;

type Rail = (p: Vec3, right: Vec3, up: Vec3) => Vec3;

const at = (p: Vec3, right: Vec3, up: Vec3, across: number, height: number): Vec3 => ({
  x: p.x + right.x * across + up.x * height,
  y: p.y + right.y * across + up.y * height,
  z: p.z + right.z * across + up.z * height
});

/**
 * One quad strip along the corridor.
 *
 * `a` and `b` are the two edges of the strip, in the order that puts the front
 * face inward. `across` is the strip's width in metres, used only for the V
 * coordinate so a 4 m tile is 4 m on every surface rather than stretched to
 * fit whatever that surface happens to be.
 */
function strip(c: Corridor, a: Rail, b: Rail, across: number): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  const edgeA: Vec3[] = [];
  const edgeB: Vec3[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const f = c.frameAt(r / RINGS);
    edgeA.push(a(f.position, f.right, f.up));
    edgeB.push(b(f.position, f.right, f.up));
  }

  for (let r = 0; r <= RINGS; r++) {
    const pa = edgeA[r]!;
    const pb = edgeB[r]!;
    /* The face normal, from the strip itself rather than from the frame: the
       two are the same thing here, and computing it from the geometry means a
       change to the rails cannot leave the lighting describing the old shape. */
    const ahead = r < RINGS ? edgeA[r + 1]! : edgeA[r]!;
    const behind = r > 0 ? edgeA[r - 1]! : edgeA[r]!;
    const dir = new Vector3(ahead.x - behind.x, ahead.y - behind.y, ahead.z - behind.z).normalize();
    const span = new Vector3(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z).normalize();
    const n = new Vector3().crossVectors(span, dir).normalize();

    const u = ((r / RINGS) * c.length) / TILE;
    position.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    normal.push(n.x, n.y, n.z, n.x, n.y, n.z);
    uv.push(u, 0, u, across / TILE);

    if (r < RINGS) {
      const i = r * 2;
      index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface Shell {
  readonly floor: BufferGeometry;
  readonly ceiling: BufferGeometry;
  readonly leftWall: BufferGeometry;
  readonly rightWall: BufferGeometry;
}

export function buildShell(c: Corridor = corridor()): Shell {
  const hw = ROOM.halfWidth;
  const ch = ROOM.ceiling;
  return {
    /* -right to +right: cross(right, travel) is up, into the room. */
    floor: strip(c, (p, r, u) => at(p, r, u, -hw, 0), (p, r, u) => at(p, r, u, hw, 0), hw * 2),
    /* +right to -right, so the same cross product comes out down. */
    ceiling: strip(c, (p, r, u) => at(p, r, u, hw, ch), (p, r, u) => at(p, r, u, -hw, ch), hw * 2),
    /* Top rail first on the left wall, bottom rail first on the right — the
       two walls are mirror images and a shared order would leave one of them
       facing out of the building. */
    leftWall: strip(c, (p, r, u) => at(p, r, u, -hw, ch), (p, r, u) => at(p, r, u, -hw, 0), ch),
    rightWall: strip(c, (p, r, u) => at(p, r, u, hw, 0), (p, r, u) => at(p, r, u, hw, ch), ch)
  };
}

/* ── the panels the works hang on ───────────────────────────────────────── */

/** Metres of border around the artwork, and how thick the slab is. */
export const PANEL = { margin: 0.16, depth: 0.09 } as const;

export interface PanelPlacement {
  readonly index: number;
  /** Places an object whose local +X is the plate's right and +Z its normal. */
  readonly matrix: Matrix4;
  readonly width: number;
  readonly height: number;
}

/**
 * Where each panel stands, as a matrix rather than as three Euler angles.
 *
 * makeBasis takes the plate's own axes straight from exhibitPoses, so the
 * object cannot end up rotated differently from the pose the gate checked.
 * The basis is right-handed by construction — facing is cross(right, up) —
 * which is what makes makeBasis a rotation rather than a rotation and a
 * mirror, and a mirrored panel would show every cover back to front.
 */
export function panelPlacements(count: number, c: Corridor = corridor()): PanelPlacement[] {
  return exhibitPoses(count, c).map((pose) => {
    const matrix = new Matrix4().makeBasis(
      new Vector3(pose.right.x, pose.right.y, pose.right.z),
      new Vector3(pose.up.x, pose.up.y, pose.up.z),
      new Vector3(pose.facing.x, pose.facing.y, pose.facing.z)
    );
    matrix.setPosition(pose.centre.x, pose.centre.y, pose.centre.z);
    return {
      index: pose.index,
      matrix,
      width: PLATE.width + PANEL.margin * 2,
      height: PLATE.height + PANEL.margin * 2
    };
  });
}
