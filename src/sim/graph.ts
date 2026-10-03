// Routing over the directed edge graph: A* with a binary heap.

import type { RoadNetwork } from './types';
import { VehicleKind } from './types';
import { KIND_PARAMS, usableLanes } from './idm';
import { edgePolyline, nodeIndex } from './geometry';

export interface RouteGraph {
  nodeCount: number;
  nodeX: Float64Array;
  nodeY: Float64Array;
  /** outgoing edge indices per node index */
  out: number[][];
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  /** fastest speed of any edge (for the admissible heuristic) */
  maxSpeed: number;
}

export function buildGraph(net: RoadNetwork): RouteGraph {
  const idx = new Map<string, number>();
  net.nodes.forEach((n, i) => idx.set(n.id, i));
  const nodeCount = net.nodes.length;
  const nodeX = new Float64Array(nodeCount);
  const nodeY = new Float64Array(nodeCount);
  net.nodes.forEach((n, i) => {
    nodeX[i] = n.x;
    nodeY[i] = n.y;
  });
  const out: number[][] = net.nodes.map(() => []);
  const edgeFrom = new Int32Array(net.edges.length);
  const edgeTo = new Int32Array(net.edges.length);
  let maxSpeed = 1;
  net.edges.forEach((e, i) => {
    const f = idx.get(e.from);
    const t = idx.get(e.to);
    edgeFrom[i] = f ?? -1;
    edgeTo[i] = t ?? -1;
    if (f !== undefined && t !== undefined) out[f].push(i);
    maxSpeed = Math.max(maxSpeed, e.speedLimit);
  });
  return { nodeCount, nodeX, nodeY, out, edgeFrom, edgeTo, maxSpeed };
}

/** Min-heap keyed by float priority. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] < key || (k[p] === key && v[p] <= val)) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** returns value; key in `lastKey` */
  lastKey = 0;
  pop(): number {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        let c = l;
        if (r < n && (k[r] < k[l] || (k[r] === k[l] && v[r] < v[l]))) c = r;
        if (k[c] > lk || (k[c] === lk && v[c] >= lv)) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    this.lastKey = topK;
    return topV;
  }
}

/**
 * Shortest path from node `from` to node `to` as a list of edge indices, or
 * null if unreachable. `cost(e)` returns seconds (Infinity = edge unusable).
 * `minSpeed` must be ≥ the fastest speed any cost can imply for the heuristic
 * to stay admissible (pass Infinity to fall back to Dijkstra).
 */
export function shortestPath(g: RouteGraph, from: number, to: number, cost: (e: number) => number, maxSpeed = g.maxSpeed): number[] | null {
  if (from < 0 || to < 0) return null;
  if (from === to) return [];
  const n = g.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const tx = g.nodeX[to], ty = g.nodeY[to];
  const h = (i: number) => (maxSpeed === Infinity ? 0 : Math.hypot(g.nodeX[i] - tx, g.nodeY[i] - ty) / maxSpeed);
  const heap = new Heap();
  dist[from] = 0;
  heap.push(h(from), from);
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    const du = dist[u];
    const outs = g.out[u];
    for (let j = 0; j < outs.length; j++) {
      const e = outs[j];
      const c = cost(e);
      if (!(c < Infinity)) continue;
      const w = g.edgeTo[e];
      if (w < 0 || done[w]) continue;
      const nd = du + c;
      if (nd < dist[w]) {
        dist[w] = nd;
        via[w] = e;
        heap.push(nd + h(w), w);
      }
    }
  }
  if (via[to] < 0) return null;
  const path: number[] = [];
  let cur = to;
  while (cur !== from) {
    const e = via[cur];
    path.push(e);
    cur = g.edgeFrom[e];
  }
  path.reverse();
  return path;
}

/**
 * Convenience: free-flow route on a raw network for a vehicle kind, as edge ids.
 * Closed edges and edges with no usable lane for the kind are excluded.
 */
export function routeOnNetwork(net: RoadNetwork, fromNode: string, toNode: string, kind: VehicleKind = VehicleKind.Car): string[] | null {
  const g = buildGraph(net);
  const ni = new Map(net.nodes.map((n, i) => [n.id, i]));
  const byId = nodeIndex(net);
  const lens = net.edges.map((e) => {
    const p = edgePolyline(e, byId);
    return p.length > 1 ? p.length : e.length;
  });
  const v0 = KIND_PARAMS[kind].v0;
  const path = shortestPath(g, ni.get(fromNode) ?? -1, ni.get(toNode) ?? -1, (i) => {
    const e = net.edges[i];
    if (e.closed || usableLanes(e, kind) === 0) return Infinity;
    return lens[i] / Math.max(0.5, Math.min(e.speedLimit, v0));
  }, Math.min(g.maxSpeed, v0));
  return path ? path.map((i) => net.edges[i].id) : null;
}
