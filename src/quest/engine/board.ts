import { mulberry32, shuffle } from "./rng";
import type { Board, BoardNode, NodeKind, Rng } from "./types";

const TAU = Math.PI * 2;

function jitteredRing(
  rng: Rng,
  nodes: BoardNode[],
  count: number,
  tier: 1 | 2 | 3,
  radius: number,
): number[] {
  const ids: number[] = [];
  const offset = rng() * TAU;
  for (let i = 0; i < count; i += 1) {
    const angle = offset + (i * TAU) / count + (rng() - 0.5) * (TAU / count) * 0.3;
    const r = radius + (rng() - 0.5) * 0.025;
    const id = nodes.length;
    nodes.push({
      id,
      kind: "path",
      tier,
      x: Math.min(1, Math.max(0, 0.5 + Math.cos(angle) * r)),
      y: Math.min(1, Math.max(0, 0.5 + Math.sin(angle) * r)),
      edges: [],
    });
    ids.push(id);
  }
  return ids;
}

function link(nodes: BoardNode[], a: number, b: number): boolean {
  if (a === b || nodes[a]!.edges.includes(b) || nodes[a]!.edges.length >= 4 || nodes[b]!.edges.length >= 4) {
    return false;
  }
  nodes[a]!.edges.push(b);
  nodes[b]!.edges.push(a);
  return true;
}

function connectRing(nodes: BoardNode[], ids: number[]): void {
  ids.forEach((id, i) => link(nodes, id, ids[(i + 1) % ids.length]!));
}

function connectRings(nodes: BoardNode[], outer: number[], inner: number[]): void {
  outer.forEach((id, i) => {
    const target = inner[Math.floor((i * inner.length) / outer.length)]!;
    link(nodes, id, target);
  });
}

function reachable(nodes: BoardNode[], start: number): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of nodes[id]!.edges) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function repairConnectivity(nodes: BoardNode[], start: number): void {
  let seen = reachable(nodes, start);
  while (seen.size < nodes.length) {
    let best: [number, number] | null = null;
    let bestDistance = Infinity;
    for (const a of seen) {
      if (nodes[a]!.edges.length >= 4) continue;
      for (const b of nodes.keys()) {
        if (seen.has(b) || nodes[b]!.edges.length >= 4) continue;
        const dx = nodes[a]!.x - nodes[b]!.x;
        const dy = nodes[a]!.y - nodes[b]!.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          best = [a, b];
          bestDistance = distance;
        }
      }
    }
    if (!best || !link(nodes, best[0], best[1])) {
      throw new Error("Unable to repair board connectivity");
    }
    seen = reachable(nodes, start);
  }
}

export function generateBoard(seed: number): Board {
  const rng = mulberry32(seed);
  const nodes: BoardNode[] = [];
  const outer = jitteredRing(rng, nodes, 14, 1, 0.42);
  const middle = jitteredRing(rng, nodes, 12, 2, 0.3);
  const inner = jitteredRing(rng, nodes, 13, 3, 0.18);

  connectRing(nodes, outer);
  connectRing(nodes, middle);
  connectRing(nodes, inner);
  connectRings(nodes, outer, middle);
  connectRings(nodes, middle, inner);

  const start = outer[0]!;
  nodes[start]!.kind = "start";

  const shrineIds = [inner[0]!, inner[4]!, inner[9]!];
  shrineIds.forEach((id, shrineIndex) => {
    nodes[id]!.kind = "shrine";
    nodes[id]!.shrineIndex = shrineIndex as 0 | 1 | 2;
  });

  const portal = nodes.length;
  nodes.push({ id: portal, kind: "portal", tier: 3, x: 0.5, y: 0.5, edges: [] });
  shrineIds.forEach((id) => link(nodes, id, portal));

  const ordinary = nodes
    .filter((node) => node.kind === "path")
    .map((node) => node.id);
  const kinds: NodeKind[] = [
    ...Array<NodeKind>(14).fill("monster"),
    ...Array<NodeKind>(7).fill("event"),
    ...Array<NodeKind>(3).fill("shop"),
    ...Array<NodeKind>(4).fill("camp"),
    ...Array<NodeKind>(3).fill("elite"),
    ...Array<NodeKind>(4).fill("path"),
  ];
  shuffle(rng, kinds);
  ordinary.forEach((id, i) => {
    nodes[id]!.kind = kinds[i]!;
  });

  repairConnectivity(nodes, start);
  nodes.forEach((node) => node.edges.sort((a, b) => a - b));
  return { seed, nodes };
}
