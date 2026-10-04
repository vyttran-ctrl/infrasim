// Fixed-time signal controller. A cycle is: for each phase green → yellow →
// all-red, then (if pedPhase > 0) an exclusive pedestrian phase where every
// vehicle approach is red.

import { Aspect, type SignalPlan } from './types';

export interface SignalRT {
  plan: SignalPlan;
  cycle: number;
  /** per phase: set of incoming edge indices that get green */
  greenSets: Set<number>[];
  /** all incoming edge indices of the node */
  incoming: number[];
}

export type SignalStage = 'green' | 'yellow' | 'allRed' | 'ped';

export interface SignalState {
  phase: number; // -1 during ped phase
  stage: SignalStage;
  /** seconds remaining in this stage */
  remaining: number;
}

export function compileSignal(plan: SignalPlan | undefined, edgeIndexById: Map<string, number>, incoming: number[]): SignalRT | null {
  if (!plan || plan.phases.length === 0) return null;
  let cycle = Math.max(0, plan.pedPhase || 0);
  for (const p of plan.phases) cycle += Math.max(0, p.green) + Math.max(0, p.yellow) + Math.max(0, p.allRed);
  if (!(cycle > 0)) return null;
  const greenSets = plan.phases.map((p) => {
    const s = new Set<number>();
    for (const id of p.greenEdges) {
      const i = edgeIndexById.get(id);
      if (i !== undefined) s.add(i);
    }
    return s;
  });
  return { plan, cycle, greenSets, incoming };
}

export function signalState(sig: SignalRT, t: number): SignalState {
  let x = (t - (sig.plan.offset || 0)) % sig.cycle;
  if (x < 0) x += sig.cycle;
  const phases = sig.plan.phases;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const g = Math.max(0, p.green), y = Math.max(0, p.yellow), r = Math.max(0, p.allRed);
    if (x < g) return { phase: i, stage: 'green', remaining: g - x };
    x -= g;
    if (x < y) return { phase: i, stage: 'yellow', remaining: y - x };
    x -= y;
    if (x < r) return { phase: i, stage: 'allRed', remaining: r - x };
    x -= r;
  }
  return { phase: -1, stage: 'ped', remaining: Math.max(0, (sig.plan.pedPhase || 0) - x) };
}

export function aspectFor(sig: SignalRT, st: SignalState, edge: number): Aspect {
  if (st.phase < 0) return Aspect.Red;
  if (!sig.greenSets[st.phase].has(edge)) return Aspect.Red;
  if (st.stage === 'green') return Aspect.Green;
  if (st.stage === 'yellow') return Aspect.Yellow;
  return Aspect.Red;
}

/** Fraction of the cycle an incoming edge has green (for diagnostics / tests). */
export function greenShare(sig: SignalRT, edge: number): number {
  let g = 0;
  sig.plan.phases.forEach((p, i) => {
    if (sig.greenSets[i].has(edge)) g += Math.max(0, p.green);
  });
  return g / sig.cycle;
}
