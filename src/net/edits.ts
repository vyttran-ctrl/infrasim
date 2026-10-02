// Pure infrastructure edits. None of these mutate their input; each returns a
// new RoadNetwork (unchanged parts are shared) with signal plans kept consistent.

import type { NetEdge, NetNode, RoadNetwork, SignalPhase, SignalPlan } from '../sim/types';
import { DEFAULT_PED_PHASE, defaultSignalPlan, reconcileSignals } from './signals';
import { clamp, nodeMap, patchEdges, polylineLength, uniqueId } from './util';

const MAX_LANES = 6;

function targets(net: RoadNetwork, edgeId: string, both: boolean): Set<string> {
  const ids = new Set<string>();
  const e = net.edges.find((x) => x.id === edgeId);
  if (!e) return ids;
  ids.add(e.id);
  if (both && e.pairId && net.edges.some((x) => x.id === e.pairId)) ids.add(e.pairId);
  return ids;
}

/** Fix bus/bike allocations so at least one general lane remains. */
function fitAllocations(e: NetEdge): NetEdge {
  let { busLanes, bikeLane } = e;
  busLanes = clamp(Math.round(busLanes), 0, e.lanes);
  if (e.lanes - busLanes - (bikeLane ? 1 : 0) < 1) busLanes = Math.max(0, e.lanes - 1 - (bikeLane ? 1 : 0));
  if (e.lanes - busLanes - (bikeLane ? 1 : 0) < 1) bikeLane = false;
  return busLanes === e.busLanes && bikeLane === e.bikeLane ? e : { ...e, busLanes, bikeLane };
}

export function setEdgeClosed(net: RoadNetwork, edgeId: string, closed: boolean, bothDirections = true): RoadNetwork {
  return patchEdges(net, targets(net, edgeId, bothDirections), (e) => (e.closed === closed ? e : { ...e, closed }));
}

export function setLanes(net: RoadNetwork, edgeId: string, lanes: number): RoadNetwork {
  const n = clamp(Math.round(Number.isFinite(lanes) ? lanes : 1), 1, MAX_LANES);
  return patchEdges(net, targets(net, edgeId, false), (e) => (e.lanes === n ? e : fitAllocations({ ...e, lanes: n })));
}

export function setCapacity(net: RoadNetwork, edgeId: string, vehPerHourPerLane: number): RoadNetwork {
  const c = Math.round(clamp(Number.isFinite(vehPerHourPerLane) ? vehPerHourPerLane : 1800, 100, 3000));
  return patchEdges(net, targets(net, edgeId, false), (e) => (e.capacity === c ? e : { ...e, capacity: c }));
}

export function setSpeedLimit(net: RoadNetwork, edgeId: string, mps: number, bothDirections = true): RoadNetwork {
  const v = clamp(Number.isFinite(mps) ? mps : 13.9, 1, 40);
  return patchEdges(net, targets(net, edgeId, bothDirections), (e) => (e.speedLimit === v ? e : { ...e, speedLimit: v }));
}

export function setBusLanes(net: RoadNetwork, edgeId: string, n: number): RoadNetwork {
  return patchEdges(net, targets(net, edgeId, false), (e) => {
    const max = Math.max(0, e.lanes - 1 - (e.bikeLane ? 1 : 0));
    const b = clamp(Math.round(Number.isFinite(n) ? n : 0), 0, max);
    return b === e.busLanes ? e : { ...e, busLanes: b };
  });
}

/**
 * Protected bike lane on the curb lane. If the street has no spare lane the
 * bus lanes give way first; on a single-lane street the bike lane is added
 * beside the traffic lane (lanes + 1) so general traffic keeps one lane.
 */
export function setBikeLane(net: RoadNetwork, edgeId: string, on: boolean, bothDirections = true): RoadNetwork {
  return patchEdges(net, targets(net, edgeId, bothDirections), (e) => {
    if (e.bikeLane === on) return e;
    if (!on) return { ...e, bikeLane: false };
    let lanes = e.lanes;
    let busLanes = e.busLanes;
    if (lanes - busLanes - 1 < 1) busLanes = Math.max(0, lanes - 2);
    if (lanes - busLanes - 1 < 1) lanes = Math.min(MAX_LANES, busLanes + 2);
    return { ...e, lanes, busLanes, bikeLane: true };
  });
}

// ---------------------------------------------------------------- nodes / signals

function patchPlan(net: RoadNetwork, nodeId: string, fn: (p: SignalPlan) => SignalPlan): RoadNetwork {
  const i = net.signals.findIndex((p) => p.nodeId === nodeId);
  if (i < 0) return net;
  const next = fn(net.signals[i]);
  if (next === net.signals[i]) return net;
  const signals = net.signals.slice();
  signals[i] = next;
  return { ...net, signals };
}

function patchNode(net: RoadNetwork, nodeId: string, fn: (n: NetNode) => NetNode): RoadNetwork {
  let changed = false;
  const nodes = net.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const m = fn(n);
    if (m !== n) changed = true;
    return m;
  });
  return changed ? { ...net, nodes } : net;
}

export function setSignalTiming(
  net: RoadNetwork,
  nodeId: string,
  phaseIndex: number,
  patch: Partial<Pick<SignalPhase, 'green' | 'yellow' | 'allRed'>>,
): RoadNetwork {
  return patchPlan(net, nodeId, (p) => {
    const ph = p.phases[phaseIndex];
    if (!ph) return p;
    const next: SignalPhase = { ...ph };
    if (patch.green !== undefined && Number.isFinite(patch.green)) next.green = clamp(patch.green, 5, 120);
    if (patch.yellow !== undefined && Number.isFinite(patch.yellow)) next.yellow = clamp(patch.yellow, 2, 8);
    if (patch.allRed !== undefined && Number.isFinite(patch.allRed)) next.allRed = clamp(patch.allRed, 0, 6);
    if (next.green === ph.green && next.yellow === ph.yellow && next.allRed === ph.allRed) return p;
    const phases = p.phases.slice();
    phases[phaseIndex] = next;
    return { ...p, phases };
  });
}

/** Exclusive pedestrian phase length (0 = none). Keeps node.pedCrossing in step. */
export function setPedPhase(net: RoadNetwork, nodeId: string, seconds: number): RoadNetwork {
  const s = clamp(Math.round(Number.isFinite(seconds) ? seconds : 0), 0, 60);
  let out = patchPlan(net, nodeId, (p) => (p.pedPhase === s ? p : { ...p, pedPhase: s }));
  if (out.signals.some((p) => p.nodeId === nodeId)) {
    out = patchNode(out, nodeId, (n) => (!!n.pedCrossing === s > 0 ? n : { ...n, pedCrossing: s > 0 }));
  }
  return out;
}

export function setPedCrossing(net: RoadNetwork, nodeId: string, on: boolean): RoadNetwork {
  let out = patchNode(net, nodeId, (n) => (n.kind === 'boundary' || !!n.pedCrossing === on ? n : { ...n, pedCrossing: on }));
  out = patchPlan(out, nodeId, (p) => {
    const s = on ? p.pedPhase || DEFAULT_PED_PHASE : 0;
    return p.pedPhase === s ? p : { ...p, pedPhase: s };
  });
  return out;
}

export function setNodeKind(net: RoadNetwork, nodeId: string, kind: 'signal' | 'priority' | 'roundabout'): RoadNetwork {
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind === 'boundary' || node.kind === kind) return net;
  let out = patchNode(net, nodeId, (n) => ({ ...n, kind }));
  out = { ...out, signals: out.signals.filter((p) => p.nodeId !== nodeId) };
  if (kind === 'signal') out = { ...out, signals: [...out.signals, defaultSignalPlan(out, nodeId)] };
  return out;
}

// ---------------------------------------------------------------- topology

function roadClassFor(lanes: number, speed: number): NetEdge['roadClass'] {
  if (lanes >= 2 || speed >= 16) return 'arterial';
  if (speed >= 13) return 'collector';
  return 'local';
}

export function addRoad(
  net: RoadNetwork,
  fromNodeId: string,
  toNodeId: string,
  opts: { lanes?: number; speedLimit?: number; twoWay?: boolean; name?: string } = {},
): { network: RoadNetwork; edgeIds: string[] } {
  const nodes = nodeMap(net);
  const a = nodes.get(fromNodeId);
  const b = nodes.get(toNodeId);
  if (!a || !b || a.id === b.id) return { network: net, edgeIds: [] };
  const lanes = clamp(Math.round(opts.lanes ?? 1), 1, MAX_LANES);
  const speedLimit = clamp(opts.speedLimit ?? 13.9, 1, 40);
  const twoWay = opts.twoWay ?? true;
  const name = opts.name?.trim() || 'New Road';
  const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const taken = new Set(net.edges.map((e) => e.id));
  const fwdId = uniqueId(`new_${a.id}_${b.id}`, taken);
  taken.add(fwdId);
  const revId = twoWay ? uniqueId(`new_${b.id}_${a.id}`, taken) : undefined;
  const base = { name, lanes, speedLimit, length, closed: false, busLanes: 0, bikeLane: false, roadClass: roadClassFor(lanes, speedLimit) };
  const fwd: NetEdge = { id: fwdId, from: a.id, to: b.id, ...base, ...(revId ? { pairId: revId } : {}) };
  const added: NetEdge[] = [fwd];
  if (revId) added.push({ id: revId, from: b.id, to: a.id, ...base, pairId: fwdId });
  // A boundary node that gains a road stays a boundary (trip endpoint).
  const network = reconcileSignals({ ...net, edges: [...net.edges, ...added] });
  return { network, edgeIds: added.map((e) => e.id) };
}

export function setOneWay(net: RoadNetwork, edgeId: string): RoadNetwork {
  const e = net.edges.find((x) => x.id === edgeId);
  if (!e || !e.pairId) return net;
  const pairId = e.pairId;
  const edges = net.edges
    .filter((x) => x.id !== pairId)
    .map((x) => {
      if (x.id !== edgeId) return x;
      const { pairId: _drop, ...rest } = x;
      void _drop;
      return rest as NetEdge;
    });
  return reconcileSignals({ ...net, edges });
}

export function setTwoWay(net: RoadNetwork, edgeId: string): RoadNetwork {
  const e = net.edges.find((x) => x.id === edgeId);
  if (!e || (e.pairId && net.edges.some((x) => x.id === e.pairId))) return net;
  const taken = new Set(net.edges.map((x) => x.id));
  const revId = uniqueId(e.id.endsWith('_r') ? e.id.slice(0, -2) : `${e.id}_r`, taken);
  const rev: NetEdge = {
    ...e,
    id: revId,
    from: e.to,
    to: e.from,
    pairId: e.id,
    ...(e.points ? { points: e.points.slice().reverse() } : {}),
  };
  const edges = net.edges.map((x) => (x.id === e.id ? { ...x, pairId: revId } : x));
  const idx = edges.findIndex((x) => x.id === e.id);
  edges.splice(idx + 1, 0, rev);
  return reconcileSignals({ ...net, edges });
}

// ---------------------------------------------------------------- analysis

/** Zone pairs (by zone name) with no path over open edges. */
export function checkConnectivity(net: RoadNetwork): { ok: boolean; unreachable: { from: string; to: string }[] } {
  const adj = new Map<string, string[]>();
  for (const e of net.edges) {
    if (e.closed) continue;
    const l = adj.get(e.from);
    if (l) l.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const reach = (starts: string[]): Set<string> => {
    const seen = new Set(starts);
    const stack = [...starts];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    return seen;
  };
  const unreachable: { from: string; to: string }[] = [];
  const zones = net.zones.filter((z) => z.nodes.length > 0);
  for (const za of zones) {
    // Per origin node so that "some origins can't get out" is caught too.
    const perNode = za.nodes.map((n) => reach([n]));
    for (const zb of zones) {
      if (zb.id === za.id) continue;
      const ok = perNode.every((r) => zb.nodes.some((n) => r.has(n)));
      if (!ok) unreachable.push({ from: za.name, to: zb.name });
    }
  }
  return { ok: unreachable.length === 0, unreachable };
}

function compassWord(dx: number, dy: number): string {
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360; // 0 = east, CCW
  if (deg < 45 || deg >= 315) return 'eastbound';
  if (deg < 135) return 'northbound';
  if (deg < 225) return 'westbound';
  return 'southbound';
}

export function edgeLabel(net: RoadNetwork, edgeId: string): string {
  const e = net.edges.find((x) => x.id === edgeId);
  if (!e) return edgeId;
  const nodes = nodeMap(net);
  const a = nodes.get(e.from);
  const b = nodes.get(e.to);
  if (!a || !b) return e.name;
  return `${e.name} (${compassWord(b.x - a.x, b.y - a.y)})`;
}

export function nodeLabel(net: RoadNetwork, nodeId: string): string {
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  if (node.name) return node.name;
  // Rank street names by how much road meets here.
  const score = new Map<string, number>();
  for (const e of net.edges) {
    if (e.from !== nodeId && e.to !== nodeId) continue;
    if (!e.name || /^unnamed/i.test(e.name)) continue;
    score.set(e.name, (score.get(e.name) ?? 0) + e.lanes * 10 + e.speedLimit);
  }
  const names = [...score.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).map((p) => p[0]);
  if (node.kind === 'boundary') {
    const nodes = nodeMap(net);
    const nb = net.edges.find((e) => e.from === nodeId || e.to === nodeId);
    let side = 'end';
    if (nb) {
      const other = nodes.get(nb.from === nodeId ? nb.to : nb.from);
      if (other) {
        const dir = compassWord(node.x - other.x, node.y - other.y).replace('bound', '');
        side = `${dir} end`;
      }
    }
    return names.length ? `${names[0]} (${side})` : `Boundary ${nodeId}`;
  }
  const suffix = node.kind === 'roundabout' ? ' roundabout' : '';
  if (names.length >= 2) return `${names[0]} & ${names[1]}${suffix}`;
  if (names.length === 1) return `${names[0]}${suffix || ' junction'}`;
  return `Junction ${nodeId}`;
}

/** Recompute `length` from geometry for every edge (used by builders). */
export function withLengths(net: RoadNetwork): RoadNetwork {
  const nodes = nodeMap(net);
  return {
    ...net,
    edges: net.edges.map((e) => {
      const pts: [number, number][] = [[nodes.get(e.from)!.x, nodes.get(e.from)!.y], ...(e.points ?? []), [nodes.get(e.to)!.x, nodes.get(e.to)!.y]];
      return { ...e, length: Math.round(polylineLength(pts) * 100) / 100 };
    }),
  };
}

