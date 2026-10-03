// Shared assertions for the network tests (not part of the public API).

import type { RoadNetwork } from '../sim/types';
import { edgePolyline, generalLanes, nodeIndex } from '../sim/geometry';
import { signalProblems } from './signals';

/** Structural problems: dangling ids, broken pairs, bad lane allocations, inconsistent signal plans. */
export function networkProblems(net: RoadNetwork): string[] {
  const out = [...signalProblems(net)];
  const nodes = nodeIndex(net);
  const edges = new Map(net.edges.map((e) => [e.id, e]));
  if (nodes.size !== net.nodes.length) out.push('duplicate node ids');
  if (edges.size !== net.edges.length) out.push('duplicate edge ids');
  for (const e of net.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) {
      out.push(`edge ${e.id} has a missing end node`);
      continue;
    }
    if (e.from === e.to) out.push(`edge ${e.id} is a self loop`);
    if (e.lanes < 1 || e.lanes > 6 || !Number.isInteger(e.lanes)) out.push(`edge ${e.id} lanes ${e.lanes}`);
    if (generalLanes(e) < 1) out.push(`edge ${e.id} has no general lane`);
    const len = edgePolyline(e, nodes).length;
    if (Math.abs(len - e.length) > 0.5) out.push(`edge ${e.id} length ${e.length} vs geometry ${len.toFixed(2)}`);
    if (e.pairId) {
      const p = edges.get(e.pairId);
      if (!p) out.push(`edge ${e.id} pair ${e.pairId} missing`);
      else if (p.pairId !== e.id || p.from !== e.to || p.to !== e.from) out.push(`edge ${e.id} pair not mutual`);
    }
  }
  for (const z of net.zones) for (const n of z.nodes) if (!nodes.has(n)) out.push(`zone ${z.id} references missing node ${n}`);
  return out;
}

/** True when every node can reach every other node over open edges. */
export function stronglyConnected(net: RoadNetwork): boolean {
  if (net.nodes.length === 0) return true;
  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const e of net.edges) {
    if (e.closed) continue;
    (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)!).push(e.to);
    (bwd.get(e.to) ?? bwd.set(e.to, []).get(e.to)!).push(e.from);
  }
  const reach = (adj: Map<string, string[]>) => {
    const seen = new Set([net.nodes[0].id]);
    const st = [net.nodes[0].id];
    while (st.length) for (const m of adj.get(st.pop()!) ?? []) if (!seen.has(m)) seen.add(m), st.push(m);
    return seen.size;
  };
  return reach(fwd) === net.nodes.length && reach(bwd) === net.nodes.length;
}
