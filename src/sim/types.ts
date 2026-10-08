// Shared contracts between the simulation worker, the network builders,
// the renderer and the UI. Everything here is plain data so it can cross
// postMessage and be serialized into saved scenarios.
//
// Units: metres, seconds, metres/second. World frame: x = east, y = north.
// Traffic drives on the right (Ontario).

export type NodeKind = 'signal' | 'priority' | 'roundabout' | 'boundary';

export interface NetNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  name?: string;
  /** Exclusive pedestrian phase (signal) or zebra crossing (priority/roundabout). */
  pedCrossing?: boolean;
}

/** A directed road segment. Two-way streets are two edges sharing `pairId`. */
export interface NetEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  lanes: number;
  /** m/s */
  speedLimit: number;
  /** metres, along the polyline */
  length: number;
  /** veh/h/lane saturation flow. Defaults to 1800 when omitted. */
  capacity?: number;
  closed: boolean;
  /** Rightmost N lanes reserved for buses. */
  busLanes: number;
  /** Rightmost general lane converted to a protected bike lane. */
  bikeLane: boolean;
  /** Edge id of the opposite direction, if the street is two-way. */
  pairId?: string;
  /** Interior polyline vertices (excluding from/to node positions). */
  points?: [number, number][];
  /** Rendering class only. */
  roadClass?: 'arterial' | 'collector' | 'local';
}

/** One signal phase: which incoming edges get green, and for how long. */
export interface SignalPhase {
  name: string; // e.g. "North/South"
  greenEdges: string[];
  green: number;
  yellow: number;
  allRed: number;
}

export interface SignalPlan {
  nodeId: string;
  phases: SignalPhase[];
  /** Exclusive pedestrian phase length in seconds, inserted after the last phase. 0 = none. */
  pedPhase: number;
  offset: number;
}

export interface Zone {
  id: string;
  name: string; // "Residential", "Campus", "North"...
  /** Nodes where trips for this zone start/end (usually boundary nodes). */
  nodes: string[];
  color?: string;
}

export interface RoadNetwork {
  id: string;
  name: string;
  nodes: NetNode[];
  edges: NetEdge[];
  signals: SignalPlan[];
  zones: Zone[];
  /**
   * Network-specific OD weights per demand preset: od[preset][originZone][destZone].
   * Falls back to the preset's own `od`, then to uniform between all zone pairs.
   */
  od?: Partial<Record<DemandPresetId, Record<string, Record<string, number>>>>;
  /**
   * Geographic bbox for networks built from real map data. Local metres are an
   * equirectangular projection around the bbox centre (see net/osm.ts projector).
   */
  geo?: { south: number; west: number; north: number; east: number };
  /** Attribution line to display, e.g. OSM. */
  attribution?: string;
}

// ---------------------------------------------------------------- demand

export type DemandPresetId = 'low' | 'normal' | 'rush' | 'event';

export interface DemandPreset {
  id: DemandPresetId;
  label: string;
  /** Multiplier on SimConfig.spawnRate. */
  rateFactor: number;
  /** OD weights: od[originZoneId][destZoneId] = relative weight. Missing = 0. */
  od?: Record<string, Record<string, number>>;
  /** Fraction of spawned vehicles that are buses. */
  busShare: number;
  /** Fraction that are bicycles (only routed over edges with bikeLane). */
  bikeShare: number;
}

export interface SimConfig {
  /** Max simultaneous vehicles. */
  maxVehicles: number;
  /** Simulated duration, seconds. */
  duration: number;
  demand: DemandPresetId;
  seed: number;
  /** veh/h across the whole network at rateFactor 1. */
  spawnRate: number;
  /** Fixed sim step, seconds. */
  dt: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  maxVehicles: 1000,
  duration: 1800,
  demand: 'rush',
  seed: 1234,
  spawnRate: 3600,
  dt: 0.2,
};

// ---------------------------------------------------------------- metrics

export interface MetricsSample {
  t: number;
  active: number;
  avgSpeed: number;
  queued: number;
  completed: number;
}

export interface MetricsSummary {
  simTime: number;
  spawned: number;
  completedTrips: number;
  active: number;
  /** seconds */
  avgTravelTime: number;
  /** m/s, over all active+completed vehicle-time */
  avgSpeed: number;
  /** seconds: travel time minus free-flow time */
  avgDelay: number;
  /** seconds of delay accrued within 40 m of a junction, per completed trip */
  intersectionDelay: number;
  /** completed veh/h */
  throughput: number;
  avgQueue: number;
  maxQueue: number;
  /** 0..1 mean edge utilization */
  utilization: number;
  /** edge ids with utilization > 0.85 or queue > 10, worst first */
  hotspots: string[];
  congestedRoads: number;
  /** km */
  distance: number;
  reroutes: number;
  /** litres */
  fuel: number;
  /** kg */
  co2: number;
  /** trips that could not be routed (disconnected network) */
  unroutable: number;
  series: MetricsSample[];
  /** Per-road totals for roads that saw traffic (used to show the local effect of an edit). */
  edges?: EdgeResult[];
}

export interface EdgeResult {
  id: string;
  /** cars that entered the road */
  entries: number;
  /** mean seconds each car lost at the junction at the end of this road */
  delay: number;
  /** largest queue seen, cars */
  maxQueue: number;
}

/** Per-edge live stats, `EDGE_STRIDE` floats per edge in network.edges order. */
export const EDGE_STRIDE = 4; // vehicles, avgSpeed (m/s), queue (veh), utilization (0..1)

/** Per-vehicle frame layout, `VEH_STRIDE` floats per active vehicle. */
export const VEH_STRIDE = 7; // x, y, heading (rad, 0 = +x, CCW), speed (m/s), kind (0 car,1 bus,2 bike), id, destZone (index into network.zones)

export enum VehicleKind {
  Car = 0,
  Bus = 1,
  Bike = 2,
}

/** Signal aspect per edge (index = edge index); NO_SIGNAL for edges not entering a signal. */
export enum Aspect {
  Green = 0,
  Yellow = 1,
  Red = 2,
  NoSignal = 255,
}

export interface SimFrame {
  t: number;
  running: boolean;
  finished: boolean;
  count: number;
  vehicles: Float32Array; // count * VEH_STRIDE
  edgeStats: Float32Array; // edges.length * EDGE_STRIDE
  aspects: Uint8Array; // edges.length
  /** Pedestrians currently crossing at node (node index) — 0/1 */
  pedActive: Uint8Array; // nodes.length
  metrics: MetricsSummary;
}

// ---------------------------------------------------------------- worker protocol

export type ToWorker =
  | { type: 'load'; network: RoadNetwork; config: SimConfig }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'speed'; value: number }
  /** Live infrastructure change during a run. Vehicles reroute. */
  | { type: 'edit'; network: RoadNetwork }
  /** Run a full scenario off-screen as fast as possible. */
  | { type: 'runHeadless'; jobId: string; network: RoadNetwork; config: SimConfig };

export type FromWorker =
  | { type: 'frame'; frame: SimFrame }
  | { type: 'progress'; jobId: string; fraction: number }
  | { type: 'headlessResult'; jobId: string; summary: MetricsSummary }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------- scenarios

export interface Scenario {
  id: string;
  name: string;
  note?: string;
  network: RoadNetwork;
  config: SimConfig;
  result?: MetricsSummary;
  createdAt: number;
}
