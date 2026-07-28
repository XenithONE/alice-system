import * as THREE from "three";

export interface TopVisualPart {
  readonly id: string;
  /** 0 crest ... 6 tip */
  readonly slot: number;
  readonly lineage: number;
  readonly role: number;
  readonly grade: number;
  readonly signature?: number;
  readonly color?: number;
}

export interface TopVisualSpec {
  readonly paint: number;
  readonly parts: readonly TopVisualPart[];
}

export interface TopVisualOptions {
  readonly exploded?: boolean;
  readonly selectedSlot?: number | null;
  readonly quality?: "high" | "battle" | "low";
  readonly playerColor?: number;
}

interface SculptRuntime {
  readonly nodes: Record<string, THREE.Group>;
  readonly sockets: Record<string, THREE.Object3D>;
  readonly colliders: readonly {
    readonly kind: "cylinder" | "cone" | "ball";
    readonly radius: number;
    readonly halfHeight: number;
    readonly y: number;
  }[];
}

const LINEAGE_COLORS = [
  0x77d9ff, // Aegis
  0xff5c49, // Raptor
  0x73f4dd, // Tempest
  0xf3b85a, // Atlas
  0xff63df, // Nova
  0x8f8cff, // Pulse
  0xa8ff84, // Revenant
  0x8a71be, // Eclipse
  0xf3f6ff // Helix
] as const;

const SLOT_Y = [0.72, 0.52, 0.31, 0.08, -0.13, -0.38, -0.67] as const;
const SLOT_LABELS = ["crest", "crown", "edge", "weight", "core", "shaft", "tip"] as const;
const SLOT_RADII = [0.35, 0.66, 0.91, 0.74, 0.49, 0.27, 0.18] as const;

const metalCache = new Map<string, THREE.MeshStandardMaterial>();
const glowCache = new Map<number, THREE.MeshStandardMaterial>();
const transformDummy = new THREE.Object3D();

type SignatureVariant = 0 | 1 | 2;

/**
 * Signature identity is encoded in the stable catalog id.  Reading it here
 * keeps rendering correct even when an older build/share payload omitted the
 * optional numeric hint.
 */
function signatureVariant(part: TopVisualPart): SignatureVariant | null {
  if (part.id.endsWith("-signature-zenith")) return 0;
  if (part.id.endsWith("-signature-paragon")) return 1;
  if (part.id.endsWith("-signature-obsidian")) return 2;
  return part.signature === 0 || part.signature === 1 || part.signature === 2
    ? part.signature
    : null;
}

function metal(color: number, role: number, grade: number): THREE.MeshStandardMaterial {
  const key = `${color}:${role}:${grade}`;
  const cached = metalCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: grade === 2 ? 0.93 : 0.82,
    roughness: Math.max(0.18, 0.38 - grade * 0.06 + role * 0.018),
    envMapIntensity: 1.18,
    vertexColors: false
  });
  material.userData.vcShared = true;
  metalCache.set(key, material);
  return material;
}

function darkMetal(): THREE.MeshStandardMaterial {
  return metal(0x151d22, 1, 1);
}

function glow(color: number): THREE.MeshStandardMaterial {
  const cached = glowCache.get(color);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 2.15,
    metalness: 0.2,
    roughness: 0.22,
    toneMapped: true
  });
  material.userData.vcShared = true;
  glowCache.set(color, material);
  return material;
}

function gearGeometry(
  innerRadius: number,
  outerRadius: number,
  teeth: number,
  height: number,
  bevel = 0.035,
  segmentsPerTooth = 4
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const points = Math.max(3, teeth) * segmentsPerTooth;
  for (let index = 0; index <= points; index += 1) {
    const turn = index / points;
    const phase = (index % segmentsPerTooth) / segmentsPerTooth;
    const tooth = phase > 0.2 && phase < 0.8;
    const radius = tooth ? outerRadius : innerRadius;
    const angle = turn * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(bevel, height * 0.35),
    bevelThickness: Math.min(bevel, height * 0.35),
    curveSegments: 2
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function annulusGeometry(
  radius: number,
  tube: number,
  detail: number
): THREE.TorusGeometry {
  return new THREE.TorusGeometry(radius - tube, tube, Math.max(6, detail / 4), detail);
}

function addFasteners(
  group: THREE.Group,
  radius: number,
  y: number,
  count: number,
  material: THREE.Material,
  scale = 1
): void {
  const geometry = new THREE.CylinderGeometry(0.025 * scale, 0.025 * scale, 0.018, 8);
  const fasteners = new THREE.InstancedMesh(geometry, material, count);
  fasteners.name = "fastener-array";
  fasteners.castShadow = true;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    transformDummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    transformDummy.rotation.set(0, 0, 0);
    transformDummy.scale.set(1, 1, 1);
    transformDummy.updateMatrix();
    fasteners.setMatrixAt(index, transformDummy.matrix);
  }
  fasteners.instanceMatrix.needsUpdate = true;
  group.add(fasteners);
}

function addRadialFins(
  group: THREE.Group,
  count: number,
  inner: number,
  outer: number,
  y: number,
  height: number,
  material: THREE.Material,
  swept: number
): void {
  const geometry = new THREE.BoxGeometry(outer - inner, height, 0.055);
  const fins = new THREE.InstancedMesh(geometry, material, count);
  fins.name = "radial-fin-array";
  fins.castShadow = true;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + swept;
    transformDummy.position.set(
      Math.cos(angle) * (inner + outer) * 0.5,
      y,
      Math.sin(angle) * (inner + outer) * 0.5
    );
    transformDummy.rotation.set(0, -angle + swept * 1.6, 0);
    transformDummy.scale.set(1, 1, 1);
    transformDummy.updateMatrix();
    fins.setMatrixAt(index, transformDummy.matrix);
  }
  fins.instanceMatrix.needsUpdate = true;
  group.add(fins);
}

function addRingStack(
  group: THREE.Group,
  baseRadius: number,
  tube: number,
  detail: number,
  radii: readonly number[],
  heights: readonly number[],
  material: THREE.Material
): void {
  const geometry = annulusGeometry(baseRadius, tube, detail);
  const stack = new THREE.InstancedMesh(geometry, material, Math.min(radii.length, heights.length));
  stack.name = "ring-stack";
  stack.castShadow = true;
  for (let index = 0; index < stack.count; index += 1) {
    const radialScale = radii[index]! / Math.max(0.001, baseRadius);
    transformDummy.position.set(0, heights[index]!, 0);
    transformDummy.rotation.set(Math.PI / 2, 0, 0);
    transformDummy.scale.set(radialScale, radialScale, 1);
    transformDummy.updateMatrix();
    stack.setMatrixAt(index, transformDummy.matrix);
  }
  stack.instanceMatrix.needsUpdate = true;
  group.add(stack);
}

function crestPart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const sides =
    signature === null
      ? 6 + (lineage % 4) * 2
      : [5, 9, 13][signature]!;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.27 + part.grade * 0.025 + (signature === null ? 0 : signature * 0.014),
      0.32 + (signature === null ? 0 : (2 - signature) * 0.012),
      0.15 + (signature === null ? 0 : 0.012 + signature * 0.006),
      signature === null ? detail : sides
    ),
    metal(part.color ?? accent, part.role, part.grade)
  );
  base.castShadow = true;
  group.add(base);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(
      signature === 2 ? 0.11 : 0.2,
      signature === 0 ? 0.29 : 0.25,
      signature === null ? 0.06 : 0.072 + signature * 0.012,
      sides
    ),
    darkMetal()
  );
  cap.position.y = 0.095;
  cap.castShadow = true;
  group.add(cap);
  const sig = new THREE.Mesh(
    new THREE.TorusKnotGeometry(
      0.09 + (signature === null ? 0 : signature * 0.008),
      0.022,
      detail * 2,
      6,
      signature === null ? 2 + lineage % 2 : [2, 3, 4][signature]!,
      signature === null ? 3 : [5, 4, 3][signature]!
    ),
    glow(accent)
  );
  sig.rotation.x = Math.PI / 2;
  sig.position.y = 0.14;
  sig.scale.y = 0.35;
  group.add(sig);
  addFasteners(
    group,
    0.22,
    0.085,
    signature === null ? 4 + (lineage % 3) : 5 + signature * 2,
    metal(0xc5d5dc, 0, 2),
    0.8
  );
}

function crownPart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const ring = new THREE.Mesh(
    annulusGeometry(
      0.64 + (signature === null ? 0 : (signature - 1) * 0.025),
      0.12 + part.grade * 0.012 + (signature === null ? 0 : 0.01 + signature * 0.006),
      detail
    ),
    metal(part.color ?? accent, part.role, part.grade)
  );
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  group.add(ring);
  addRadialFins(
    group,
    signature === null ? 5 + lineage : [15, 18, 21][signature]!,
    0.22,
    signature === null ? 0.61 : 0.64 + signature * 0.025,
    0,
    0.075 + part.role * 0.006 + (signature === null ? 0 : 0.018 + signature * 0.006),
    lineage % 2 === 0 ? darkMetal() : metal(part.color ?? accent, part.role, part.grade),
    signature === null ? (lineage - 4) * 0.018 : [-0.14, 0.04, 0.18][signature]!
  );
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.39, 0.11, detail),
    darkMetal()
  );
  inner.castShadow = true;
  group.add(inner);
  addFasteners(group, 0.38, 0.065, 6, glow(accent), 0.65);
}

function edgePart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const teeth =
    signature === null
      ? 6 + lineage + part.role * 2
      : [23, 27, 31][signature]!;
  const inner =
    0.77 + part.grade * 0.015 + (signature === null ? 0 : signature * 0.008);
  const outer =
    0.87 +
    part.grade * 0.025 +
    (part.role === 0 ? 0.035 : 0) +
    (signature === null ? 0 : 0.035 + signature * 0.018);
  const blade = new THREE.Mesh(
    gearGeometry(
      inner,
      outer,
      teeth,
      0.15 + part.grade * 0.018 + (signature === null ? 0 : 0.012 + signature * 0.006),
      signature === null ? 0.028 : 0.038
    ),
    metal(part.color ?? accent, part.role, part.grade)
  );
  blade.castShadow = true;
  blade.receiveShadow = true;
  group.add(blade);
  const bumper = new THREE.Mesh(
    annulusGeometry(0.75, 0.055, detail),
    darkMetal()
  );
  bumper.rotation.x = Math.PI / 2;
  group.add(bumper);
  const energy = new THREE.Mesh(
    annulusGeometry(0.69, 0.018, detail),
    glow(accent)
  );
  energy.rotation.x = Math.PI / 2;
  group.add(energy);
}

function weightPart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const radius =
    0.67 +
    (part.role === 1 ? 0.05 : 0) +
    (signature === null ? 0 : 0.025 + signature * 0.018);
  const weight = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius * (signature === 0 ? 0.88 : signature === 2 ? 1.06 : 1),
      radius * (signature === 1 ? 0.84 : 0.96),
      0.18 + part.grade * 0.025 + (signature === null ? 0 : 0.018 + signature * 0.01),
      detail
    ),
    metal(part.color ?? 0x78858d, part.role, part.grade)
  );
  weight.castShadow = true;
  group.add(weight);
  const inset = new THREE.Mesh(
    annulusGeometry(radius * 0.88, 0.05, detail),
    glow(accent)
  );
  inset.rotation.x = Math.PI / 2;
  group.add(inset);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.29, 0.22, detail),
    darkMetal()
  );
  hub.castShadow = true;
  group.add(hub);
  addFasteners(
    group,
    radius * 0.68,
    0.105,
    signature === null ? 5 + lineage % 5 : [10, 12, 14][signature]!,
    metal(0xc3d0d5, 2, 2),
    0.85
  );
}

function corePart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.43 + (signature === null ? 0 : signature * 0.018),
      0.48 + (signature === null ? 0 : (2 - signature) * 0.016),
      0.23 + (signature === null ? 0 : 0.018 + signature * 0.008),
      signature === null ? detail : [18, 24, 30][signature]!
    ),
    metal(part.color ?? accent, part.role, part.grade)
  );
  cage.castShadow = true;
  group.add(cage);
  const reactor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.31, 0.25, detail),
    glow(accent)
  );
  group.add(reactor);
  const rings = signature === null ? 2 + (lineage % 3) : [5, 6, 7][signature]!;
  addRingStack(
    group,
    0.36,
    0.018,
    detail,
    Array.from({ length: rings }, (_, index) => 0.36 + index * 0.018),
    Array.from({ length: rings }, (_, index) => (index - (rings - 1) / 2) * 0.045),
    darkMetal()
  );
  addRadialFins(
    group,
    signature === null ? 4 + lineage % 4 : [9, 11, 13][signature]!,
    0.29,
    signature === null ? 0.47 : 0.49 + signature * 0.018,
    0,
    signature === null ? 0.08 : 0.1 + signature * 0.008,
    darkMetal(),
    signature === null ? 0.02 : [-0.12, 0.06, 0.16][signature]!
  );
}

function shaftPart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const length =
    0.3 +
    part.grade * 0.035 +
    (part.role === 3 ? 0.03 : 0) +
    (signature === null ? 0 : 0.035 + signature * 0.025);
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.18 + (signature === 2 ? 0.025 : 0),
      0.23 + (signature === 0 ? 0.035 : 0),
      length,
      signature === null ? detail : [12, 20, 28][signature]!
    ),
    metal(part.color ?? 0x66757d, part.role, part.grade)
  );
  shaft.castShadow = true;
  group.add(shaft);
  const collar = new THREE.Mesh(annulusGeometry(0.225, 0.04, detail), glow(accent));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = length * 0.28;
  group.add(collar);
  const grooves = signature === null ? 3 + (lineage % 4) : [7, 8, 9][signature]!;
  addRingStack(
    group,
    0.19,
    0.014,
    detail,
    Array.from({ length: grooves }, () => 0.19),
    Array.from(
      { length: grooves },
      (_, index) => -length * 0.25 + index * (length * 0.5 / Math.max(1, grooves - 1))
    ),
    darkMetal()
  );
}

function tipPart(
  group: THREE.Group,
  part: TopVisualPart,
  accent: number,
  detail: number
): void {
  const lineage = part.lineage % 9;
  const signature = signatureVariant(part);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.2 + (signature === null ? 0 : signature * 0.012),
      0.16 + (signature === null ? 0 : (2 - signature) * 0.012),
      0.13 + (signature === null ? 0 : 0.012 + signature * 0.006),
      detail
    ),
    metal(part.color ?? accent, part.role, part.grade)
  );
  collar.castShadow = true;
  group.add(collar);
  let tipGeometry: THREE.BufferGeometry;
  if (signature === 0) {
    tipGeometry = new THREE.ConeGeometry(0.155, 0.34, Math.max(12, detail));
  } else if (signature === 1) {
    tipGeometry = new THREE.SphereGeometry(0.17, detail, Math.max(8, detail / 2));
  } else if (signature === 2) {
    tipGeometry = new THREE.CylinderGeometry(0.135, 0.185, 0.235, detail);
  } else if (part.role === 2) {
    tipGeometry = new THREE.SphereGeometry(0.13 + part.grade * 0.008, detail, detail / 2);
  } else if (part.role === 1) {
    tipGeometry = new THREE.CylinderGeometry(0.11, 0.14, 0.18, detail);
  } else {
    tipGeometry = new THREE.ConeGeometry(0.14 + lineage * 0.002, 0.28, detail);
  }
  const tip = new THREE.Mesh(tipGeometry, part.role === 2 ? darkMetal() : metal(0xb9c5ca, part.role, part.grade));
  tip.position.y =
    signature === 0 ? -0.2 :
    signature === 1 ? -0.18 :
    signature === 2 ? -0.185 :
    -0.17;
  tip.castShadow = true;
  group.add(tip);
  const light = new THREE.Mesh(annulusGeometry(0.155, 0.018, detail), glow(accent));
  light.rotation.x = Math.PI / 2;
  light.position.y = 0.02;
  group.add(light);
}

const BUILDERS = [crestPart, crownPart, edgePart, weightPart, corePart, shaftPart, tipPart] as const;

function applySelection(root: THREE.Group, selectedSlot: number | null): void {
  for (const child of root.children) {
    const group = child as THREE.Group;
    const slot = Number(group.userData.vcSlot ?? -1);
    const selected = selectedSlot === null || selectedSlot === slot;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const source of materials) {
        if (!(source instanceof THREE.MeshStandardMaterial)) continue;
        const material = source.clone();
        material.userData.vcTransient = true;
        if (!selected) {
          material.transparent = true;
          material.opacity = 0.3;
          material.depthWrite = false;
        } else if (selectedSlot !== null) {
          material.emissive = material.emissive.clone().add(new THREE.Color(0x123c49));
          material.emissiveIntensity = Math.max(0.4, material.emissiveIntensity);
        }
        object.material = material;
      }
    });
  }
}

export function createTopVisual(spec: TopVisualSpec, options: TopVisualOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "vortex-top";
  const quality = options.quality ?? "high";
  const detail = quality === "high" ? 48 : quality === "battle" ? 28 : 18;
  const exploded = options.exploded ?? false;
  const selectedSlot = options.selectedSlot ?? null;
  const nodes: Record<string, THREE.Group> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const sorted = [...spec.parts].sort((a, b) => a.slot - b.slot);

  for (const part of sorted) {
    const slot = THREE.MathUtils.clamp(Math.trunc(part.slot), 0, 6);
    const accent = LINEAGE_COLORS[part.lineage % LINEAGE_COLORS.length] ?? options.playerColor ?? spec.paint;
    const group = new THREE.Group();
    group.name = `${SLOT_LABELS[slot]}:${part.id}`;
    group.userData.vcSlot = slot;
    group.userData.vcPartId = part.id;
    group.userData.vcLineage = part.lineage;
    group.position.y = SLOT_Y[slot] + (exploded ? (3 - slot) * 0.21 : 0);
    BUILDERS[slot](group, part, accent, detail);
    nodes[SLOT_LABELS[slot]] = group;
    const socket = new THREE.Object3D();
    socket.name = `${SLOT_LABELS[slot]}-socket`;
    socket.position.y = 0;
    group.add(socket);
    sockets[SLOT_LABELS[slot]] = socket;
    root.add(group);
  }

  const aura = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 0.98, 0.015, detail, 1, true),
    new THREE.MeshBasicMaterial({
      color: options.playerColor ?? spec.paint,
      transparent: true,
      opacity: quality === "low" ? 0.08 : 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  aura.name = "energy-aura";
  aura.position.y = SLOT_Y[2];
  root.add(aura);

  const runtime: SculptRuntime = {
    nodes,
    sockets,
    colliders: [
      { kind: "cylinder", radius: 0.9, halfHeight: 0.12, y: SLOT_Y[2] },
      { kind: "cylinder", radius: 0.68, halfHeight: 0.18, y: SLOT_Y[3] },
      { kind: "cylinder", radius: 0.46, halfHeight: 0.22, y: SLOT_Y[4] },
      { kind: "cone", radius: 0.2, halfHeight: 0.3, y: SLOT_Y[6] }
    ]
  };
  root.userData.sculptRuntime = runtime;
  root.userData.vcBasePositions = root.children
    .filter((child) => child.userData.vcSlot !== undefined)
    .map((child) => ({ child, y: child.position.y }));

  // Four battle tops must remain below the global 150-call budget. Geometry
  // detail still catches the arena lighting; only the high-LOD editor pays
  // for per-part shadow-map passes.
  if (quality !== "high") {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
  }

  if (selectedSlot !== null) applySelection(root, selectedSlot);
  return root;
}

export function updateTopPresentation(
  root: THREE.Group,
  options: { exploded: boolean; selectedSlot?: number | null }
): void {
  const selectedSlot = options.selectedSlot ?? null;
  for (const child of root.children) {
    const slot = Number(child.userData.vcSlot ?? -1);
    if (slot < 0) continue;
    child.position.y = SLOT_Y[slot] + (options.exploded ? (3 - slot) * 0.21 : 0);
  }
  if (selectedSlot !== null) applySelection(root, selectedSlot);
}

export function disposeTopVisual(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.userData.vcShared !== true) material.dispose();
      }
      return;
    }
    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose();
      if (object.material.userData.vcShared !== true) object.material.dispose();
    }
  });
  root.clear();
}

export function topRadiusForSlot(slot: number): number {
  return SLOT_RADII[THREE.MathUtils.clamp(Math.trunc(slot), 0, 6)] ?? 0.5;
}

export function topHeightForSlot(slot: number): number {
  return SLOT_Y[THREE.MathUtils.clamp(Math.trunc(slot), 0, 6)] ?? 0;
}
