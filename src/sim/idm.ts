// Intelligent Driver Model (Treiber et al. 2000) and per-kind parameters.

import { VehicleKind, type NetEdge } from './types';

export interface KindParams {
  /** vehicle length, m */
  len: number;
  /** max acceleration, m/s² */
  a: number;
  /** comfortable deceleration, m/s² */
  b: number;
  /** jam distance, m */
  s0: number;
  /** desired time headway, s */
  T: number;
  /** kind's own maximum desired speed, m/s */
  v0: number;
}

export const KIND_PARAMS: Record<VehicleKind, KindParams> = {
  [VehicleKind.Car]: { len: 4.5, a: 1.5, b: 2.0, s0: 2.0, T: 1.3, v0: 36 },
  [VehicleKind.Bus]: { len: 12, a: 1.0, b: 1.6, s0: 3.0, T: 1.6, v0: 17 },
  [VehicleKind.Bike]: { len: 1.8, a: 1.0, b: 1.5, s0: 1.0, T: 1.0, v0: 5.5 },
};

/** Hardest deceleration the model will ever produce, m/s². */
export const MAX_DECEL = 9;

/**
 * IDM acceleration.
 * @param gap bumper-to-bumper distance to the leader (Infinity = free road)
 * @param dv  approach rate v − v_leader
 */
export function idmAccel(v: number, v0: number, gap: number, dv: number, a: number, b: number, s0: number, T: number): number {
  const free = 1 - Math.pow(v / Math.max(0.1, v0), 4);
  if (gap === Infinity) return Math.max(-MAX_DECEL, a * free);
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const g = Math.max(0.1, gap);
  const acc = a * (free - (sStar / g) * (sStar / g));
  return Math.max(-MAX_DECEL, acc);
}

// ---------------------------------------------------------------- lane types

export const LANE_GENERAL = 0;
export const LANE_BUS = 1;
export const LANE_BIKE = 2;
export type LaneType = 0 | 1 | 2;

/** Lane 0 = curb. Bike lane (if any) is lane 0, then `busLanes` bus lanes, rest general. */
export function laneType(edge: NetEdge, lane: number): LaneType {
  const bike = edge.bikeLane ? 1 : 0;
  if (bike && lane === 0) return LANE_BIKE;
  if (lane < bike + edge.busLanes) return LANE_BUS;
  return LANE_GENERAL;
}

export function laneAllowed(type: LaneType, kind: VehicleKind): boolean {
  if (kind === VehicleKind.Bike) return type === LANE_BIKE;
  if (kind === VehicleKind.Bus) return type !== LANE_BIKE;
  return type === LANE_GENERAL;
}

/** Number of lanes on the edge the given kind may use. */
export function usableLanes(edge: NetEdge, kind: VehicleKind): number {
  let n = 0;
  for (let i = 0; i < edge.lanes; i++) if (laneAllowed(laneType(edge, i), kind)) n++;
  return n;
}

/** Free-flow speed of a kind on an edge (no driver factor). */
export function freeFlowSpeed(edge: NetEdge, kind: VehicleKind): number {
  return Math.max(0.5, Math.min(edge.speedLimit, KIND_PARAMS[kind].v0));
}
