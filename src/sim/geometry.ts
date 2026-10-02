// Shared road geometry. The simulation and the renderer both place lanes
// with these helpers so a vehicle drawn at (x, y) sits exactly on the lane
// the renderer painted.

import type { NetEdge, NetNode, RoadNetwork } from './types';

export const LANE_WIDTH = 3.5;
/** Distance before the end node where vehicles stop for a red light / yield. */
export const STOP_LINE_SETBACK = 9;
/** Radius of the junction box drawn at each node. */
export const JUNCTION_RADIUS = 9;

export interface Polyline {
  pts: [number, number][];
  /** cumulative distance at each vertex */
  cum: number[];
  length: number;
}

export function edgePolyline(edge: NetEdge, nodeById: Map<string, NetNode>): Polyline {
  const a = nodeById.get(edge.from)!;
  const b = nodeById.get(edge.to)!;
  const pts: [number, number][] = [[a.x, a.y], ...(edge.points ?? []), [b.x, b.y]];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/**
 * Lateral offset (to the right of travel direction) of a lane centre from the
 * street centreline. Lane 0 is the rightmost (curb) lane.
 * Two-way streets put their lanes right of the centreline; one-way streets
 * are centred on it.
 */
export function laneOffset(edge: NetEdge, lane: number): number {
  const fromCurb = edge.lanes - 1 - lane; // 0 = innermost
  if (edge.pairId) return (fromCurb + 0.5) * LANE_WIDTH;
  return (fromCurb + 0.5 - edge.lanes / 2) * LANE_WIDTH;
}

/** Point and heading at distance `s` along the polyline, shifted `offset` to the right. */
export function pointAt(poly: Polyline, s: number, offset = 0): { x: number; y: number; heading: number } {
  const { pts, cum } = poly;
  const d = Math.max(0, Math.min(poly.length, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const u = (d - cum[i - 1]) / seg;
  const dx = (x1 - x0) / seg;
  const dy = (y1 - y0) / seg;
  // right normal of (dx, dy) is (dy, -dx)
  return {
    x: x0 + (x1 - x0) * u + dy * offset,
    y: y0 + (y1 - y0) * u - dx * offset,
    heading: Math.atan2(dy, dx),
  };
}

export function nodeIndex(net: RoadNetwork): Map<string, NetNode> {
  return new Map(net.nodes.map((n) => [n.id, n]));
}

export function networkBounds(net: RoadNetwork): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of net.nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Effective general-traffic lanes after bus/bike conversions. */
export function generalLanes(edge: NetEdge): number {
  return Math.max(0, edge.lanes - edge.busLanes - (edge.bikeLane ? 1 : 0));
}

export interface JunctionLayout {
  /** Junction box radius per node index (0 = no box). */
  nodeRadius: number[];
  /** Centreline radius of circulating traffic per node index (roundabouts only, else 0). */
  ringRadius: number[];
  /** Stop-line distance before the end node, per edge index. */
  stopSetback: number[];
}

const ZEBRA_ROOM = 3.6;
const RING_WIDTH = Math.max(6, LANE_WIDTH * 2);

function halfStreetWidth(e: NetEdge, byId: Map<string, NetEdge>): number {
  if (e.pairId) {
    const p = byId.get(e.pairId);
    return Math.max(e.lanes, p ? p.lanes : e.lanes) * LANE_WIDTH;
  }
  return (e.lanes * LANE_WIDTH) / 2;
}

/**
 * Junction sizes and stop lines, shared by the renderer (what is painted)
 * and the simulation (where vehicles actually stop and circulate).
 */
export function junctionLayout(net: RoadNetwork): JunctionLayout {
  const nodeById = nodeIndex(net);
  const edgeById = new Map(net.edges.map((e) => [e.id, e]));
  const nodeIdx = new Map(net.nodes.map((n, i) => [n.id, i]));
  const maxW = new Array<number>(net.nodes.length).fill(0);
  const streets: Set<string>[] = net.nodes.map(() => new Set());
  for (const e of net.edges) {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    const hw = halfStreetWidth(e, edgeById);
    const key = e.pairId && e.pairId < e.id ? e.pairId : e.id;
    for (const nid of [e.from, e.to]) {
      const i = nodeIdx.get(nid)!;
      maxW[i] = Math.max(maxW[i], hw);
      streets[i].add(key);
    }
  }
  const nodeRadius = net.nodes.map((node, i) => {
    const deg = streets[i].size;
    if (node.kind === 'roundabout') return Math.max(JUNCTION_RADIUS + 5, maxW[i] + 8);
    if (node.kind !== 'boundary' && deg >= 3) return Math.max(JUNCTION_RADIUS, maxW[i] + 2);
    if (node.kind !== 'boundary' && deg === 2) return maxW[i];
    return 0;
  });
  // vehicles circulate on the outer lane of the painted ring
  const ringRadius = net.nodes.map((node, i) => (node.kind === 'roundabout' ? nodeRadius[i] - RING_WIDTH / 4 : 0));
  const stopSetback = net.edges.map((e) => {
    const b = nodeIdx.get(e.to);
    if (b === undefined) return STOP_LINE_SETBACK;
    const node = net.nodes[b];
    if (node.kind === 'roundabout') return nodeRadius[b];
    const zebra = node.pedCrossing ? ZEBRA_ROOM : 0;
    return Math.max(STOP_LINE_SETBACK, nodeRadius[b] > 0 ? maxW[b] + 0.8 + zebra : 0);
  });
  return { nodeRadius, ringRadius, stopSetback };
}

export const ROUNDABOUT_RING_WIDTH = RING_WIDTH;
