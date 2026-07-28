import * as THREE from "three";
import { topHeightForSlot, topRadiusForSlot } from "./topFactory";

export interface BattlePresentation {
  /**
   * The first N seats are the co-op player team. Remaining seats are enemies.
   * Omit this (or the whole presentation argument) for the classic free-for-all
   * palette.
   */
  readonly playerCount?: number;
  readonly wave?: number;
  /**
   * One seven-entry array per seat, ordered Crest through Tip.
   * A value of 1 is the normal equipped part; values above 1 are roguelike
   * duplicate stacks represented by augmentation hardware.
   */
  readonly stackCounts?: readonly (readonly number[])[];
}

export interface BattleSeatPresentation {
  readonly team: "ally" | "enemy";
  readonly color: number;
  readonly wave: number;
  readonly stackCounts: readonly number[];
  readonly extraStacks: number;
}

export const MAX_STACK_DECORATIONS = 12;

const CLASSIC_COLORS = [0x62ddff, 0xffb448, 0xff5bd7, 0x6effb2] as const;
const ENEMY_COLORS = [0xff3f4f, 0xe81931, 0xff785b, 0xb80f2d] as const;
const SLOT_COLORS = [
  0x79e8ff,
  0x709bff,
  0xff6b4d,
  0xffc34f,
  0xff69dc,
  0xa98cff,
  0x73f2a7,
] as const;

interface StackDecorationDescriptor {
  readonly slot: number;
  readonly ordinal: number;
  readonly kind: "ring" | "fin";
}

function finiteInteger(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? THREE.MathUtils.clamp(Math.trunc(value), 0, maximum)
    : fallback;
}

function normalizedStackCounts(source: readonly number[] | undefined): readonly number[] {
  return Array.from(
    { length: 7 },
    (_, slot) => Math.max(1, finiteInteger(source?.[slot], 1, 999)),
  );
}

function enemyColor(seat: number, playerCount: number, wave: number): number {
  const source = new THREE.Color(
    ENEMY_COLORS[(seat - playerCount) % ENEMY_COLORS.length] ?? ENEMY_COLORS[0],
  );
  // Later waves read hotter without introducing another material or draw.
  source.offsetHSL(0, Math.min(0.08, wave * 0.002), Math.min(0.1, wave * 0.004));
  return source.getHex();
}

export function resolveBattlePresentation(
  seats: number,
  presentation?: BattlePresentation,
): readonly BattleSeatPresentation[] {
  const count = Math.max(0, Math.trunc(seats));
  const playerCount = presentation
    ? finiteInteger(presentation.playerCount, count, count)
    : count;
  const wave = finiteInteger(presentation?.wave, 0, 9999);
  return Array.from({ length: count }, (_, seat) => {
    const stackCounts = normalizedStackCounts(presentation?.stackCounts?.[seat]);
    const extraStacks = stackCounts.reduce(
      (total, stackCount) => total + Math.max(0, stackCount - 1),
      0,
    );
    const team = seat < playerCount ? "ally" : "enemy";
    return {
      team,
      color:
        team === "ally"
          ? CLASSIC_COLORS[seat % CLASSIC_COLORS.length]!
          : enemyColor(seat, playerCount, wave),
      wave,
      stackCounts,
      extraStacks,
    };
  });
}

function stackDescriptors(stackCounts: readonly number[]): readonly StackDecorationDescriptor[] {
  const descriptors: StackDecorationDescriptor[] = [];
  const maximumStack = Math.max(1, ...stackCounts);
  // Round-robin by layer prevents one highly stacked slot from hiding every
  // other equipped slot when the twelve-piece presentation cap is reached.
  for (let ordinal = 1; ordinal < maximumStack; ordinal += 1) {
    for (let slot = 0; slot < 7; slot += 1) {
      if ((stackCounts[slot] ?? 1) <= ordinal) continue;
      descriptors.push({
        slot,
        ordinal,
        kind: (slot + ordinal) % 3 === 0 ? "fin" : "ring",
      });
      if (descriptors.length === MAX_STACK_DECORATIONS) return descriptors;
    }
  }
  return descriptors;
}

function stackColor(
  slot: number,
  team: BattleSeatPresentation["team"],
  teamColor: number,
  wave: number,
): THREE.Color {
  const color = new THREE.Color(SLOT_COLORS[slot] ?? SLOT_COLORS[0]);
  const teamBlend = team === "enemy" ? 0.82 : 0.2;
  color.lerp(new THREE.Color(teamColor), teamBlend);
  color.offsetHSL(0, 0.02, Math.min(0.12, wave * 0.003));
  return color;
}

/**
 * Creates at most two draw calls (instanced rings + instanced fins), while
 * exposing up to twelve individually colored stack pieces.
 */
export function createBattleStackDecoration(
  seat: BattleSeatPresentation,
): THREE.Group {
  const root = new THREE.Group();
  root.name = "roguelike-stack-augmentation";
  root.userData.vcStackDecorationCount = 0;
  root.userData.vcTotalExtraStacks = seat.extraStacks;
  root.userData.vcWave = seat.wave;
  root.userData.vcTeam = seat.team;
  const descriptors = stackDescriptors(seat.stackCounts);
  root.userData.vcStackDecorationCount = descriptors.length;
  if (descriptors.length === 0) return root;

  const commonMaterial = {
    color: 0xffffff,
    emissive: new THREE.Color(seat.color),
    emissiveIntensity: Math.min(
      1.25,
      0.3 + seat.wave * 0.025 + seat.extraStacks * 0.018,
    ),
    metalness: 0.72,
    roughness: 0.24,
    transparent: true,
    opacity: 0.76,
    depthWrite: true,
  } satisfies THREE.MeshStandardMaterialParameters;
  const ringDescriptors = descriptors.filter((descriptor) => descriptor.kind === "ring");
  const finDescriptors = descriptors.filter((descriptor) => descriptor.kind === "fin");
  const transform = new THREE.Object3D();

  if (ringDescriptors.length > 0) {
    const geometry = new THREE.TorusGeometry(1, 0.025, 6, 32);
    const material = new THREE.MeshStandardMaterial(commonMaterial);
    const rings = new THREE.InstancedMesh(geometry, material, ringDescriptors.length);
    rings.name = "stack-ring-array";
    rings.castShadow = false;
    rings.receiveShadow = false;
    ringDescriptors.forEach((descriptor, index) => {
      const layer = Math.min(4, descriptor.ordinal);
      const radius = topRadiusForSlot(descriptor.slot) + 0.075 + layer * 0.028;
      transform.position.set(
        0,
        topHeightForSlot(descriptor.slot) + (descriptor.ordinal % 2 === 0 ? -0.035 : 0.035),
        0,
      );
      transform.rotation.set(Math.PI / 2, 0, descriptor.ordinal * 0.19);
      transform.scale.set(radius, radius, 1);
      transform.updateMatrix();
      rings.setMatrixAt(index, transform.matrix);
      rings.setColorAt(
        index,
        stackColor(descriptor.slot, seat.team, seat.color, seat.wave),
      );
    });
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    root.add(rings);
  }

  if (finDescriptors.length > 0) {
    const geometry = new THREE.BoxGeometry(0.23, 0.055, 0.075);
    geometry.translate(0.115, 0, 0);
    const material = new THREE.MeshStandardMaterial({
      ...commonMaterial,
      opacity: 0.86,
      roughness: 0.2,
    });
    const fins = new THREE.InstancedMesh(geometry, material, finDescriptors.length);
    fins.name = "stack-fin-array";
    fins.castShadow = false;
    fins.receiveShadow = false;
    finDescriptors.forEach((descriptor, index) => {
      const angle =
        descriptor.slot * 2.399963229728653 +
        descriptor.ordinal * 0.83;
      const radius = topRadiusForSlot(descriptor.slot) + 0.045;
      transform.position.set(
        Math.cos(angle) * radius,
        topHeightForSlot(descriptor.slot),
        Math.sin(angle) * radius,
      );
      transform.rotation.set(
        (descriptor.ordinal % 3 - 1) * 0.16,
        -angle,
        (descriptor.slot - 3) * 0.035,
      );
      const size = 1 + Math.min(0.32, descriptor.ordinal * 0.035);
      transform.scale.set(size, size, size);
      transform.updateMatrix();
      fins.setMatrixAt(index, transform.matrix);
      fins.setColorAt(
        index,
        stackColor(descriptor.slot, seat.team, seat.color, seat.wave),
      );
    });
    fins.instanceMatrix.needsUpdate = true;
    if (fins.instanceColor) fins.instanceColor.needsUpdate = true;
    root.add(fins);
  }

  return root;
}

/**
 * Keeps each slot's silhouette and brightest accent for crowded encounters.
 * The geometry remains available for a later four-player setup, but invisible
 * cosmetic meshes do not enter the render list.
 */
export function applyCrowdBattleLod(root: THREE.Group): number {
  for (const slotRoot of root.children) {
    if (slotRoot.userData.vcSlot === undefined) continue;
    const meshes: THREE.Mesh[] = [];
    slotRoot.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    const structural = meshes[0];
    const luminous = meshes.find((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return materials.some(
        (material) =>
          material instanceof THREE.MeshStandardMaterial &&
          material.emissiveIntensity > 0 &&
          material.emissive.getHex() !== 0,
      );
    });
    for (const mesh of meshes) {
      mesh.visible = mesh === structural || mesh === luminous;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  }

  let visibleMeshes = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return;
      current = current.parent;
    }
    visibleMeshes += 1;
  });
  root.userData.vcCrowdLod = true;
  root.userData.vcVisibleMeshDraws = visibleMeshes;
  return visibleMeshes;
}
