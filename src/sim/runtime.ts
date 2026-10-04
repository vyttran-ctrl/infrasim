// Runtime (mutable) state shared by the engine modules.

import type { NetEdge, NetNode } from './types';
import { VehicleKind } from './types';
import type { Polyline } from './geometry';
import type { LaneType } from './idm';
import type { SignalRT } from './signals';

export class Veh {
  id: number;
  tripId: number;
  kind: VehicleKind;
  len: number;
  a: number;
  b: number;
  s0: number;
  T: number;
  speedFactor: number;
  politeness: number;
  destNode: number;
  destZone: number;
  /** edge indices; `ri` = index of current edge */
  route: number[] = [];
  ri = 0;
  /** current edge index, -1 while circulating in a roundabout */
  edge = -1;
  lane = 0;
  /** front-bumper position along the edge, m */
  s = 0;
  v = 0;
  acc = 0;
  /** visual lateral offset, m (interpolates toward the lane centre) */
  lat = 0;
  /** junction permission for this step (only meaningful for lane candidates) */
  permit = false;
  /** last step's permission (commitment: can't stop → keep going) */
  wasPermitted = false;
  /** time the vehicle first stood at the stop line on its current edge, -1 if not */
  stoppedAt = -1;
  lastLC = -1e9;
  /** priority junction box occupancy */
  boxNode = -1;
  boxEdge = -1;
  boxIn = -1;
  /** movement through the box: entry / exit angles (see junction.movementsConflict) */
  boxTi = 0;
  boxTo = 0;
  /** route ends at the current edge without reaching destination (unroutable after edit) */
  doomed = false;
  // roundabout state
  ringNode = -1;
  ringTheta0 = 0;
  ringLen = 0;
  ringProg = 0;
  /** circulating radius of the ring this vehicle is on */
  ringR = 9;
  // metrics
  spawnT: number;
  enterT = 0;
  dist = 0;
  freeFlow = 0;
  intDelay = 0;
  edgeDelay = 0;
  fuel = 0;
  /** index in the engine's active array */
  slot = -1;

  constructor(id: number, tripId: number, kind: VehicleKind, spawnT: number) {
    this.id = id;
    this.tripId = tripId;
    this.kind = kind;
    this.spawnT = spawnT;
    this.len = 0;
    this.a = 0;
    this.b = 0;
    this.s0 = 0;
    this.T = 0;
    this.speedFactor = 1;
    this.politeness = 0.3;
    this.destNode = -1;
    this.destZone = 0;
  }
}

export interface LaneRT {
  type: LaneType;
  /** vehicles ordered front (largest s) → back */
  vehs: Veh[];
  /** first vehicle that has not yet passed the stop line */
  cand: Veh | null;
}

export interface EdgeRT {
  idx: number;
  id: string;
  def: NetEdge;
  from: number;
  to: number;
  poly: Polyline;
  length: number;
  stopLine: number;
  lanes: LaneRT[];
  /** usable lane count per VehicleKind */
  usable: [number, number, number];
  /** junction appears blocked for this approach (used by lane-change estimates) */
  blockedEst: boolean;
  /** heading (rad) at the end / start of the polyline */
  headingEnd: number;
  headingStart: number;
  /** importance rank for priority junctions */
  rank: number;
  /** ends at a non-boundary node */
  isApproach: boolean;
  /** headway multiplier from the edge's saturation-flow capacity */
  tFactor: number;

  // live stats (reset every step)
  count: number;
  sumSpeed: number;
  queue: number;
  util: number;
  // smoothed / accumulated stats (survive edits by edge id)
  stats: EdgeAccum;
}

export interface EdgeAccum {
  /** observed speed for routing, m/s (EMA) */
  obsSpeed: number;
  utilFast: number;
  utilSlow: number;
  queueSlow: number;
  utilTime: number;
  queueTime: number;
  vehTime: number;
  entries: number;
  exits: number;
  delaySum: number;
}

export interface BoxEntry {
  /** incoming index */
  k: number;
  ti: number;
  to: number;
}

export type NodeControl = 'signal' | 'priority' | 'roundabout' | 'free';

export interface NodeRT {
  idx: number;
  id: string;
  def: NetNode;
  control: NodeControl;
  incoming: number[];
  outgoing: number[];
  /** aligned with `incoming` */
  major: boolean[];
  /** vehicles currently inside the junction box (priority nodes) */
  box: BoxEntry[];
  signal: SignalRT | null;
  ring: Veh[];
  /** circulating radius for roundabouts (from geometry.junctionLayout) */
  ringR: number;
  /** pedestrians crossing until this time (non-signal crossings) */
  pedUntil: number;
  pedNext: number;
  pedActive: boolean;
}
