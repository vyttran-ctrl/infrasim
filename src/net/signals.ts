// Signal plan generation and the consistency pass every edit runs through.
//
// Invariant kept by `reconcileSignals`: every signal node has exactly one plan,
// every edge entering a signal node appears in exactly one of its phases, and
// no phase references an edge that is missing or doesn't enter that node.

import type { NetEdge, NetNode, RoadNetwork, SignalPhase, SignalPlan } from '../sim/types';
import { approachAngle, axisDiff, meanAxis, nodeMap } from './util';

export const DEFAULT_YELLOW = 4;
export const DEFAULT_ALL_RED = 2;
export const MAJOR_GREEN = 30;
export const MINOR_GREEN = 25;
export const DEFAULT_PED_PHASE = 12;

interface Approach {
  edge: NetEdge;
  axis: number; // approach direction, radians
}

function incoming(net: RoadNetwork, nodeId: string): NetEdge[] {
  return net.edges.filter((e) => e.to === nodeId && e.from !== nodeId);
}

/** Split approaches into ≤2 groups of roughly opposing legs. */
function groupApproaches(apps: Approach[]): Approach[][] {
  if (apps.length <= 1) return apps.length ? [apps] : [];
  let best: Approach[][] = [apps];
  let bestScore = -Infinity;
  for (const cand of apps) {
    const a = apps.filter((p) => axisDiff(p.axis, cand.axis) < Math.PI / 4);
    const b = apps.filter((p) => axisDiff(p.axis, cand.axis) >= Math.PI / 4);
    let score = 0;
    for (const g of [a, b]) {
      if (!g.length) continue;
      const m = meanAxis(g.map((p) => p.axis));
      for (const p of g) score += Math.cos(2 * axisDiff(p.axis, m));
    }
    // Prefer genuinely two-phase splits when the legs aren't all collinear.
    if (b.length) score += 0.01;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = b.length ? [a, b] : [a];
    }
  }
  return best;
}

function weight(g: Approach[]): number {
  return g.reduce((s, p) => s + p.edge.lanes * p.edge.speedLimit, 0);
}

/** |sin| of the group's mean axis: 1 = pure north/south, 0 = pure east/west. */
function northness(g: Approach[]): number {
  return Math.abs(Math.sin(meanAxis(g.map((p) => p.axis))));
}

function axisName(g: Approach[]): string {
  const m = meanAxis(g.map((p) => p.axis)); // 0..π, 0 = east
  const deg = (m * 180) / Math.PI;
  if (deg < 22.5 || deg >= 157.5) return 'East/West';
  if (deg < 67.5) return 'NE/SW';
  if (deg < 112.5) return 'North/South';
  return 'NW/SE';
}

export function defaultSignalPlan(net: RoadNetwork, nodeId: string): SignalPlan {
  const nodes = nodeMap(net);
  const node = nodes.get(nodeId);
  const apps: Approach[] = incoming(net, nodeId).map((edge) => ({ edge, axis: approachAngle(edge, nodes) }));
  const groups = groupApproaches(apps);
  let phases: SignalPhase[];
  if (groups.length === 2) {
    const [g0, g1] = groups;
    const nsFirst = northness(g0) >= northness(g1);
    const names = nsFirst ? ['North/South', 'East/West'] : ['East/West', 'North/South'];
    const named = [
      { g: g0, name: names[0] },
      { g: g1, name: names[1] },
    ].sort((p, q) => weight(q.g) - weight(p.g));
    phases = named.map((p, i) => ({
      name: p.name,
      greenEdges: p.g.map((a) => a.edge.id),
      green: i === 0 ? MAJOR_GREEN : MINOR_GREEN,
      yellow: DEFAULT_YELLOW,
      allRed: DEFAULT_ALL_RED,
    }));
  } else if (groups.length === 1) {
    phases = [
      {
        name: axisName(groups[0]),
        greenEdges: groups[0].map((a) => a.edge.id),
        green: MAJOR_GREEN,
        yellow: DEFAULT_YELLOW,
        allRed: DEFAULT_ALL_RED,
      },
    ];
  } else {
    phases = [];
  }
  return { nodeId, phases, pedPhase: node?.pedCrossing ? DEFAULT_PED_PHASE : 0, offset: 0 };
}

function reconcilePlan(net: RoadNetwork, node: NetNode, plan: SignalPlan, nodes: Map<string, NetNode>, inc: NetEdge[]): SignalPlan {
  const incIds = new Set(inc.map((e) => e.id));
  const seen = new Set<string>();
  let changed = false;
  let phases = plan.phases.map((ph) => {
    const keep = ph.greenEdges.filter((id) => {
      if (!incIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (keep.length !== ph.greenEdges.length) {
      changed = true;
      return { ...ph, greenEdges: keep };
    }
    return ph;
  });
  const missing = inc.filter((e) => !seen.has(e.id));
  if (missing.length) {
    const byId = new Map(inc.map((e) => [e.id, e]));
    const axes = phases.map((ph) =>
      ph.greenEdges.length ? meanAxis(ph.greenEdges.map((id) => approachAngle(byId.get(id)!, nodes))) : null,
    );
    if (axes.every((a) => a === null)) {
      // Nothing to anchor on: start over from the geometry.
      return defaultSignalPlanFor(net, node.id, plan);
    }
    phases = phases.map((ph) => ({ ...ph, greenEdges: [...ph.greenEdges] }));
    for (const e of missing) {
      const ax = approachAngle(e, nodes);
      let bi = -1;
      let bd = Infinity;
      axes.forEach((a, i) => {
        if (a === null) return;
        const d = axisDiff(a, ax);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      phases[bi].greenEdges.push(e.id);
    }
    changed = true;
  }
  if (phases.some((ph) => ph.greenEdges.length === 0) && phases.some((ph) => ph.greenEdges.length > 0)) {
    phases = phases.filter((ph) => ph.greenEdges.length > 0);
    changed = true;
  }
  if (phases.length === 0 && inc.length > 0) return defaultSignalPlanFor(net, node.id, plan);
  return changed ? { ...plan, phases } : plan;
}

/** Fresh default plan that keeps the old ped phase / offset. */
function defaultSignalPlanFor(net: RoadNetwork, nodeId: string, old?: SignalPlan): SignalPlan {
  const p = defaultSignalPlan(net, nodeId);
  return old ? { ...p, pedPhase: old.pedPhase, offset: old.offset } : p;
}

/** Bring every signal plan in line with the current edges and node kinds. */
export function reconcileSignals(net: RoadNetwork): RoadNetwork {
  const nodes = nodeMap(net);
  const incByNode = new Map<string, NetEdge[]>();
  for (const e of net.edges) {
    if (e.from === e.to) continue;
    const l = incByNode.get(e.to);
    if (l) l.push(e);
    else incByNode.set(e.to, [e]);
  }
  const planByNode = new Map<string, SignalPlan>();
  for (const p of net.signals) if (!planByNode.has(p.nodeId)) planByNode.set(p.nodeId, p);
  const signals: SignalPlan[] = [];
  let changed = planByNode.size !== net.signals.length;
  for (const node of net.nodes) {
    const old = planByNode.get(node.id);
    if (node.kind !== 'signal') {
      if (old) changed = true;
      continue;
    }
    const plan = old
      ? reconcilePlan(net, node, old, nodes, incByNode.get(node.id) ?? [])
      : defaultSignalPlanFor(net, node.id);
    if (plan !== old) changed = true;
    signals.push(plan);
  }
  // Plans whose node vanished are dropped above (we only iterate existing nodes).
  if (!changed && signals.length === net.signals.length && signals.every((p, i) => p === net.signals[i])) return net;
  return { ...net, signals };
}

/** Returns a list of problems; empty means the signal plans are consistent. */
export function signalProblems(net: RoadNetwork): string[] {
  const problems: string[] = [];
  const nodes = nodeMap(net);
  const edgeIds = new Set(net.edges.map((e) => e.id));
  const planCount = new Map<string, number>();
  for (const p of net.signals) {
    planCount.set(p.nodeId, (planCount.get(p.nodeId) ?? 0) + 1);
    const node = nodes.get(p.nodeId);
    if (!node) {
      problems.push(`plan for missing node ${p.nodeId}`);
      continue;
    }
    if (node.kind !== 'signal') problems.push(`plan on non-signal node ${p.nodeId}`);
    const seen = new Map<string, number>();
    for (const ph of p.phases) {
      for (const id of ph.greenEdges) {
        if (!edgeIds.has(id)) problems.push(`${p.nodeId}: phase ${ph.name} references missing edge ${id}`);
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    for (const e of net.edges) {
      if (e.to !== p.nodeId || e.from === e.to) continue;
      const c = seen.get(e.id) ?? 0;
      if (c !== 1) problems.push(`${p.nodeId}: incoming edge ${e.id} is in ${c} phases`);
    }
    for (const id of seen.keys()) {
      const e = net.edges.find((x) => x.id === id);
      if (e && e.to !== p.nodeId) problems.push(`${p.nodeId}: phase edge ${id} does not enter the node`);
    }
  }
  for (const n of net.nodes) {
    if (n.kind === 'signal' && (planCount.get(n.id) ?? 0) !== 1) problems.push(`signal node ${n.id} has ${planCount.get(n.id) ?? 0} plans`);
  }
  return problems;
}
