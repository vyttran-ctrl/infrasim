// Junction control: decides, every step, whether the first vehicle of each
// approach lane that has not yet crossed the stop line may proceed
// (`veh.permit`). A vehicle without permission sees a virtual stopped
// obstacle at the stop line.
//
//  signal      green → go; yellow → go only if it cannot stop comfortably; red → stop.
//  priority    major approaches (highest road class / speed) go unless a minor
//              vehicle is inside the junction box; minor approaches must stop,
//              then go first-come-first-served when the box is clear of other
//              approaches and no major vehicle arrives within GAP_ACCEPT s.
//              If every approach ranks equally it is an all-way stop.
//  roundabout  capacity-limited ring: entry needs ring count < RING_CAP and no
//              circulating vehicle about to pass the entry.
//  free        uncontrolled (boundary / mid-block nodes).
// Pedestrians crossing at a non-signal node block every entry.
// Any entry is also blocked if the downstream lane has no room (spillback).
// "Commitment": a vehicle that had permission and can no longer stop
// comfortably keeps it (except at a red signal, which is always enforced).

import { Aspect } from './types';
import { JUNCTION_RADIUS } from './geometry';
import type { BoxEntry, EdgeRT, NodeRT, Veh } from './runtime';

export const RING_R = JUNCTION_RADIUS;
export const RING_V = 7;
export const RING_CAP = 8;
/** comfortable deceleration used for yellow / commitment decisions */
export const B_COMF = 3.5;
/** minor-road critical gap, s */
export const GAP_ACCEPT = 4.5;
/** roundabout entries look this far ahead (angle, rad) for circulating traffic */
const RING_CONFLICT_UP = 1.1;
const RING_CONFLICT_DOWN = 0.35;

export interface JunctionCtx {
  t: number;
  edges: EdgeRT[];
  nodes: NodeRT[];
  aspects: Uint8Array;
  nextEdge(v: Veh): number;
  /** true if the lane `v` would enter on edge `next` is full at its start and not moving (spillback) */
  downstreamBlocked(next: number, v: Veh): boolean;
}

interface Cand {
  v: Veh;
  e: EdgeRT;
  k: number; // incoming index at the node
  lane: number;
  d: number;
  dest: boolean;
  spill: boolean;
  committed: boolean;
  /** movement: entry angle (direction node → where the vehicle comes from) and exit angle */
  ti: number;
  to: number;
}

const TWO_PI = Math.PI * 2;
export function angMod(a: number): number {
  a %= TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Arc length driven CCW around the ring from entry angle to the exit edge heading. */
export function ringArc(theta0: number, exitHeading: number, r: number): number {
  let d = angMod(exitHeading - theta0);
  if (d < 0.3) d += TWO_PI;
  return r * d;
}

export function ringAngle(v: Veh): number {
  return v.ringTheta0 + Math.min(v.ringProg, v.ringLen) / v.ringR;
}

function gather(ctx: JunctionCtx, node: NodeRT, out: Cand[]) {
  const t = ctx.t;
  for (let k = 0; k < node.incoming.length; k++) {
    const e = ctx.edges[node.incoming[k]];
    e.blockedEst = false;
    for (let li = 0; li < e.lanes.length; li++) {
      const v = e.lanes[li].cand;
      if (!v) continue;
      const d = e.stopLine - v.s;
      if (v.v < 0.5 && d < 4 && v.stoppedAt < 0) v.stoppedAt = t;
      const nx = ctx.nextEdge(v);
      const dest = nx < 0;
      const spill = !dest && ctx.downstreamBlocked(nx, v);
      const canStop = (v.v * v.v) / (2 * B_COMF) <= d + 0.5;
      const ti = e.headingEnd + Math.PI;
      const to = dest ? ti + Math.PI : ctx.edges[nx].headingStart;
      out.push({ v, e, k, lane: li, d, dest, spill, committed: v.permit && !canStop, ti, to });
    }
  }
}

const buf: Cand[] = [];

export function evaluateNode(ctx: JunctionCtx, node: NodeRT): void {
  evaluateControl(ctx, node);
  // trips ending at this node never wait for it: they leave the network at the stop line
  for (const c of buf) if (c.dest) c.v.permit = true;
}

function evaluateControl(ctx: JunctionCtx, node: NodeRT): void {
  buf.length = 0;
  gather(ctx, node, buf);
  if (buf.length === 0) {
    if (node.control === 'signal') for (const ei of node.incoming) ctx.edges[ei].blockedEst = ctx.aspects[ei] !== Aspect.Green;
    else if (node.pedActive) for (const ei of node.incoming) ctx.edges[ei].blockedEst = true;
    return;
  }

  if (node.control === 'signal') {
    for (const c of buf) {
      const asp = ctx.aspects[c.e.idx];
      const canStop = (c.v.v * c.v.v) / (2 * B_COMF) <= c.d + 0.5;
      let p = asp === Aspect.Green || (asp === Aspect.Yellow && !canStop);
      if (p && c.spill && !c.committed) p = false;
      c.v.permit = p;
    }
    for (const ei of node.incoming) ctx.edges[ei].blockedEst = ctx.aspects[ei] !== Aspect.Green;
    return;
  }

  if (node.pedActive) {
    for (const c of buf) {
      c.v.permit = c.committed;
      c.e.blockedEst = true;
    }
    return;
  }

  if (node.control === 'free') {
    for (const c of buf) {
      c.v.permit = c.dest || !c.spill || c.committed;
      if (!c.v.permit) c.e.blockedEst = true;
    }
    return;
  }

  if (node.control === 'roundabout') {
    evaluateRoundabout(node);
    return;
  }

  evaluatePriority(ctx, node);
}

/**
 * Do two movements through a junction conflict? Each movement is a chord of a
 * circle around the node from its entry angle to its exit angle. Same entry =
 * following (no conflict); same exit = merge (conflict); otherwise they
 * conflict when the chords cross. With right-hand traffic a shared endpoint
 * (one's exit leg is the other's entry leg) conflicts when the other end lies
 * on the right-hand side (CCW arc) of the first movement.
 */
export function movementsConflict(ai: number, ao: number, bi: number, bo: number): boolean {
  const near = (x: number, y: number) => {
    const d = angMod(x - y);
    return d < 0.25 || d > TWO_PI - 0.25;
  };
  if (near(ai, bi)) return false;
  if (near(ao, bo)) return true;
  const span = angMod(ao - ai);
  const inArc = (x: number) => {
    const d = angMod(x - ai);
    return d > 0 && d < span;
  };
  if (near(bi, ao)) return inArc(bo);
  if (near(bo, ai)) return inArc(bi);
  return inArc(bi) !== inArc(bo);
}

function evaluatePriority(ctx: JunctionCtx, node: NodeRT) {
  const box: BoxEntry[] = node.box.slice();
  const conflictsBox = (c: Cand, minorOnly: boolean) => {
    for (const b of box) {
      if (b.k === c.k) continue;
      if (minorOnly && node.major[b.k]) continue;
      if (movementsConflict(c.ti, c.to, b.ti, b.to)) return true;
    }
    return false;
  };

  // majors: go unless a conflicting minor vehicle is already inside the box
  const majorsComing: Cand[] = [];
  for (const c of buf) {
    if (!node.major[c.k]) continue;
    c.v.permit = c.committed || ((c.dest || !c.spill) && !conflictsBox(c, true));
    if (!c.v.permit) c.e.blockedEst = true;
    if (c.v.v > 1 && c.d / c.v.v < GAP_ACCEPT) majorsComing.push(c);
  }

  // minors: stop, then first come first served when no conflicting movement is near
  const minors = buf.filter((c) => !node.major[c.k]);
  minors.sort((a, b) => {
    const sa = a.v.stoppedAt < 0 ? Infinity : a.v.stoppedAt;
    const sb = b.v.stoppedAt < 0 ? Infinity : b.v.stoppedAt;
    if (sa !== sb) return sa - sb;
    if (a.e.idx !== b.e.idx) return a.e.idx - b.e.idx;
    return a.lane - b.lane;
  });
  const t = ctx.t;
  for (const c of minors) {
    let ok = c.committed;
    if (!ok) {
      const ready = c.v.stoppedAt >= 0 && t - c.v.stoppedAt >= 0.6 && (c.dest || !c.spill);
      ok = ready && !conflictsBox(c, false) && !majorsComing.some((m) => m.k !== c.k && movementsConflict(c.ti, c.to, m.ti, m.to));
    }
    c.v.permit = ok;
    if (ok) box.push({ k: c.k, ti: c.ti, to: c.to });
    else c.e.blockedEst = true;
  }
}

function evaluateRoundabout(node: NodeRT) {
  const angles: number[] = node.ring.map(ringAngle);
  let count = node.ring.length;
  const near = buf.filter((c) => c.d < 35 || c.committed);
  for (const c of buf) if (!(c.d < 35 || c.committed)) c.v.permit = true;
  near.sort((a, b) => a.d - b.d || a.e.idx - b.e.idx || a.lane - b.lane);
  for (const c of near) {
    const th = c.e.headingEnd + Math.PI;
    if (c.committed || c.dest) {
      c.v.permit = true;
      if (!c.dest) {
        count++;
        angles.push(th);
      }
      continue;
    }
    let ok = count < RING_CAP && !c.spill;
    for (let i = 0; i < angles.length && ok; i++) {
      if (angMod(th - angles[i]) < RING_CONFLICT_UP || angMod(angles[i] - th) < RING_CONFLICT_DOWN) ok = false;
    }
    c.v.permit = ok;
    if (ok) {
      count++;
      angles.push(th);
    } else c.e.blockedEst = true;
  }
}
