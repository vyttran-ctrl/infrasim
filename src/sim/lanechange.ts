// Lane changing: MOBIL (Kesting, Treiber, Helbing 2007) for discretionary
// changes, plus mandatory changes out of lanes the vehicle may not use
// (e.g. a car on a lane that was just converted to a bus lane).
// Any lane may enter any lane of the next edge, so no turn-lane logic is needed.
// The change itself is instantaneous; the renderer-facing `lat` offset
// interpolates toward the new lane.

import { VehicleKind } from './types';
import { LANE_BUS, laneAllowed } from './idm';
import type { EdgeRT, Veh } from './runtime';

export const LC_THRESHOLD = 0.2; // m/s² incentive needed
export const LC_SAFE_DECEL = 4; // m/s² max imposed braking on the new follower
export const LC_SAFE_DECEL_MANDATORY = 6;
export const LC_COOLDOWN = 3; // s
export const BUS_LANE_BIAS = 0.4;

export interface LCContext {
  t: number;
  stepCount: number;
  dt: number;
  edges: EdgeRT[];
  active: Veh[];
  /** IDM acceleration of `v` on edge `e` if `leader` were its leader (null = lane ahead clear) */
  accelWith(v: Veh, e: EdgeRT, leader: Veh | null): number;
}

/** First index in a front→back (descending s) array whose vehicle is behind position `s`. */
export function insertIndex(vehs: Veh[], s: number): number {
  let lo = 0, hi = vehs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vehs[mid].s >= s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearestAllowed(e: EdgeRT, v: Veh): number {
  let best = -1;
  for (let i = 0; i < e.lanes.length; i++) {
    if (!laneAllowed(e.lanes[i].type, v.kind)) continue;
    if (best < 0 || Math.abs(i - v.lane) < Math.abs(best - v.lane)) best = i;
  }
  return best;
}

export function laneChangePass(ctx: LCContext): void {
  const every = Math.max(1, Math.round(1 / ctx.dt));
  const t = ctx.t;
  for (let n = 0; n < ctx.active.length; n++) {
    const v = ctx.active[n];
    if (v.edge < 0) continue;
    const e = ctx.edges[v.edge];
    if (e.lanes.length < 2) continue;
    const cur = e.lanes[v.lane];
    const mandatory = !laneAllowed(cur.type, v.kind);
    let goal = -1;
    if (mandatory) {
      if (t - v.lastLC < 1) continue;
      goal = nearestAllowed(e, v);
      if (goal < 0) continue;
    } else {
      if ((v.id + ctx.stepCount) % every !== 0) continue;
      if (t - v.lastLC < LC_COOLDOWN) continue;
      if (v.s < 4 || e.stopLine - v.s < 12) continue;
    }
    const ci = cur.vehs.indexOf(v);
    const oldLead = ci > 0 ? cur.vehs[ci - 1] : null;
    const oldFol = ci + 1 < cur.vehs.length ? cur.vehs[ci + 1] : null;
    let best = -1;
    let bestGain = mandatory ? -Infinity : LC_THRESHOLD;
    for (let dir = -1; dir <= 1; dir += 2) {
      const nl = v.lane + dir;
      if (nl < 0 || nl >= e.lanes.length) continue;
      const target = e.lanes[nl];
      if (mandatory) {
        if (Math.sign(goal - v.lane) !== dir) continue;
      } else if (!laneAllowed(target.type, v.kind)) continue;
      const idx = insertIndex(target.vehs, v.s);
      const lead = idx > 0 ? target.vehs[idx - 1] : null;
      const fol = idx < target.vehs.length ? target.vehs[idx] : null;
      if (lead && lead.s - lead.len - v.s < 1) continue;
      if (fol && v.s - v.len - fol.s < 1) continue;
      const folNew = fol ? ctx.accelWith(fol, e, v) : 0;
      if (fol && folNew < -(mandatory ? LC_SAFE_DECEL_MANDATORY : LC_SAFE_DECEL)) continue;
      const selfNew = ctx.accelWith(v, e, lead);
      let gain: number;
      if (mandatory) gain = selfNew;
      else {
        const folOld = fol ? fol.acc : 0;
        const oldFolOld = oldFol ? oldFol.acc : 0;
        const oldFolNew = oldFol ? ctx.accelWith(oldFol, e, oldLead) : 0;
        gain = selfNew - v.acc + v.politeness * (folNew - folOld + (oldFolNew - oldFolOld));
        if (v.kind === VehicleKind.Bus) {
          if (target.type === LANE_BUS) gain += BUS_LANE_BIAS;
          if (cur.type === LANE_BUS) gain -= BUS_LANE_BIAS;
        }
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = nl;
      }
    }
    if (best < 0) continue;
    cur.vehs.splice(ci, 1);
    const target = e.lanes[best];
    target.vehs.splice(insertIndex(target.vehs, v.s), 0, v);
    v.lane = best;
    v.lastLC = t;
    v.permit = false;
    v.stoppedAt = -1;
  }
}
