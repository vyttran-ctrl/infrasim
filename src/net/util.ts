// Small geometry / graph helpers shared by the network builders and edits.

import type { NetEdge, NetNode, RoadNetwork } from '../sim/types';

export function nodeMap(net: RoadNetwork): Map<string, NetNode> {
  return new Map(net.nodes.map((n) => [n.id, n]));
}

export function edgeMap(net: RoadNetwork): Map<string, NetEdge> {
  return new Map(net.edges.map((e) => [e.id, e]));
}

/** Full polyline of an edge, node positions included. */
export function edgePoints(edge: NetEdge, nodes: Map<string, NetNode>): [number, number][] {
  const a = nodes.get(edge.from);
  const b = nodes.get(edge.to);
  if (!a || !b) return [];
  return [[a.x, a.y], ...(edge.points ?? []), [b.x, b.y]];
}

export function polylineLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/**
 * Direction (radians, 0 = +x/east, CCW) pointing from the edge's end node back
 * up the approach, i.e. where the traffic of this incoming edge comes from.
 */
export function approachAngle(edge: NetEdge, nodes: Map<string, NetNode>): number {
  const pts = edgePoints(edge, nodes);
  if (pts.length < 2) return 0;
  const [x1, y1] = pts[pts.length - 1];
  // Look back a little along the polyline so a kink right at the junction doesn't dominate.
  let i = pts.length - 2;
  while (i > 0 && Math.hypot(pts[i][0] - x1, pts[i][1] - y1) < 15) i--;
  return Math.atan2(pts[i][1] - y1, pts[i][0] - x1);
}

/** Overall travel direction of an edge (from start to end), radians. */
export function travelAngle(edge: NetEdge, nodes: Map<string, NetNode>): number {
  const a = nodes.get(edge.from);
  const b = nodes.get(edge.to);
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Smallest difference between two undirected axes (angles mod π), in [0, π/2]. */
export function axisDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** Mean of undirected axes (doubled-angle average), radians in [0, π). */
export function meanAxis(angles: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(2 * a);
    sy += Math.sin(2 * a);
  }
  let m = Math.atan2(sy, sx) / 2;
  if (m < 0) m += Math.PI;
  return m;
}

export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Replace one edge (by id) with a patched copy; returns the same array entries otherwise. */
export function patchEdges(net: RoadNetwork, ids: Set<string>, patch: (e: NetEdge) => NetEdge): RoadNetwork {
  let changed = false;
  const edges = net.edges.map((e) => {
    if (!ids.has(e.id)) return e;
    const n = patch(e);
    if (n !== e) changed = true;
    return n;
  });
  return changed ? { ...net, edges } : net;
}
