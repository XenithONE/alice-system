import type {
  RingSurfaceMesh,
  SimRingArena,
  SimRingPoint,
} from "./types";

/**
 * The profile is the source of truth for both rendering and Rapier.  Heights
 * are intentionally gentle near the centre and rise into a launchable rim.
 */
export const RING_ARENAS: readonly SimRingArena[] = [
  {
    id: "core-bowl",
    name: "Core Bowl",
    nameJa: "コア・ボウル",
    profile: [
      { radius: 0, height: -0.62 },
      { radius: 1.8, height: -0.55 },
      { radius: 3.8, height: -0.3 },
      { radius: 5.8, height: 0.08 },
      { radius: 6.9, height: 0.42 },
      { radius: 7.35, height: 0.54 },
    ],
    outRadius: 7.38,
    spawnRadius: 3.6,
    friction: 0.54,
    restitution: 0.26,
  },
  {
    id: "wide-dish",
    name: "Wide Dish",
    nameJa: "ワイド・ディッシュ",
    profile: [
      { radius: 0, height: -0.38 },
      { radius: 2.5, height: -0.34 },
      { radius: 5.3, height: -0.16 },
      { radius: 7.4, height: 0.14 },
      { radius: 8.35, height: 0.38 },
      { radius: 8.75, height: 0.45 },
    ],
    outRadius: 8.78,
    spawnRadius: 4.25,
    friction: 0.46,
    restitution: 0.2,
  },
  {
    id: "pressure-crater",
    name: "Pressure Crater",
    nameJa: "プレッシャー・クレーター",
    profile: [
      { radius: 0, height: -0.82 },
      { radius: 1.35, height: -0.71 },
      { radius: 2.9, height: -0.34 },
      { radius: 4.5, height: 0.2 },
      { radius: 5.65, height: 0.72 },
      { radius: 6.1, height: 0.86 },
    ],
    outRadius: 6.13,
    spawnRadius: 2.95,
    friction: 0.62,
    restitution: 0.34,
  },
  {
    id: "wave-ring",
    name: "Wave Ring",
    nameJa: "ウェーブ・リング",
    profile: [
      { radius: 0, height: -0.52 },
      { radius: 1.75, height: -0.46 },
      { radius: 3.8, height: -0.21 },
      { radius: 5.75, height: 0.13 },
      { radius: 6.95, height: 0.49 },
      { radius: 7.45, height: 0.6 },
    ],
    outRadius: 7.48,
    spawnRadius: 3.7,
    friction: 0.5,
    restitution: 0.29,
    waveAmplitude: 0.13,
    waveCount: 8,
  },
  {
    id: "eclipse-ring",
    name: "Eclipse Ring",
    nameJa: "エクリプス・リング",
    profile: [
      { radius: 0, height: 0.12 },
      { radius: 1.1, height: 0.02 },
      { radius: 2.35, height: -0.43 },
      { radius: 4.1, height: -0.5 },
      { radius: 5.8, height: -0.11 },
      { radius: 6.95, height: 0.47 },
      { radius: 7.35, height: 0.57 },
    ],
    outRadius: 7.38,
    spawnRadius: 3.75,
    friction: 0.56,
    restitution: 0.24,
  },
] as const;

const RINGS_BY_ID = new Map(RING_ARENAS.map((arena) => [arena.id, arena]));

export function ringArenaById(id: string): SimRingArena {
  return RINGS_BY_ID.get(id as SimRingArena["id"]) ?? RING_ARENAS[0]!;
}

function interpolateProfile(profile: readonly SimRingPoint[], radius: number): number {
  if (radius <= profile[0]!.radius) return profile[0]!.height;
  for (let index = 1; index < profile.length; index += 1) {
    const right = profile[index]!;
    if (radius > right.radius) continue;
    const left = profile[index - 1]!;
    const span = Math.max(1e-6, right.radius - left.radius);
    const t = (radius - left.radius) / span;
    const smooth = t * t * (3 - 2 * t);
    return left.height + (right.height - left.height) * smooth;
  }
  return profile[profile.length - 1]!.height;
}

export function sampleRingHeight(
  arena: SimRingArena,
  radius: number,
  angle = 0,
): number {
  const base = interpolateProfile(arena.profile, radius);
  if (!arena.waveAmplitude || !arena.waveCount) return base;
  const edge = arena.profile[arena.profile.length - 1]!.radius;
  const normalized = Math.min(1, Math.max(0, radius / Math.max(edge, 1e-6)));
  const envelope = Math.sin(Math.PI * normalized) ** 2;
  return base + Math.sin(angle * arena.waveCount) * arena.waveAmplitude * envelope;
}

/**
 * Generates a radially sampled triangle mesh.  `radialSegments` and
 * `angularSegments` may be lowered for physics/LOD, but every consumer still
 * samples the exact same arena profile.
 */
export function buildRingSurfaceMesh(
  arena: SimRingArena,
  radialSegments = 24,
  angularSegments = 96,
): RingSurfaceMesh {
  const radial = Math.max(2, Math.floor(radialSegments));
  const angular = Math.max(12, Math.floor(angularSegments));
  const edgeRadius = arena.profile[arena.profile.length - 1]!.radius;
  const vertexCount = 1 + radial * angular;
  const vertices = new Float32Array(vertexCount * 3);
  vertices[0] = 0;
  vertices[1] = sampleRingHeight(arena, 0, 0);
  vertices[2] = 0;

  const vertexIndex = (ring: number, segment: number): number =>
    1 + (ring - 1) * angular + (segment % angular);

  for (let ring = 1; ring <= radial; ring += 1) {
    const radius = edgeRadius * (ring / radial);
    for (let segment = 0; segment < angular; segment += 1) {
      const angle = segment / angular * Math.PI * 2;
      const index = vertexIndex(ring, segment) * 3;
      vertices[index] = Math.cos(angle) * radius;
      vertices[index + 1] = sampleRingHeight(arena, radius, angle);
      vertices[index + 2] = Math.sin(angle) * radius;
    }
  }

  const triangleCount = angular + (radial - 1) * angular * 2;
  const indices = new Uint32Array(triangleCount * 3);
  let cursor = 0;
  for (let segment = 0; segment < angular; segment += 1) {
    indices[cursor++] = 0;
    indices[cursor++] = vertexIndex(1, segment + 1);
    indices[cursor++] = vertexIndex(1, segment);
  }
  for (let ring = 1; ring < radial; ring += 1) {
    for (let segment = 0; segment < angular; segment += 1) {
      const a = vertexIndex(ring, segment);
      const b = vertexIndex(ring, segment + 1);
      const c = vertexIndex(ring + 1, segment);
      const d = vertexIndex(ring + 1, segment + 1);
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = d;
      indices[cursor++] = a;
      indices[cursor++] = d;
      indices[cursor++] = c;
    }
  }
  return {
    vertices,
    indices,
    radialSegments: radial,
    angularSegments: angular,
  };
}
