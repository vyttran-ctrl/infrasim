// Demand: the trip list is generated from the seed BEFORE the simulation and
// depends only on zones/OD/config — never on roads, lanes or signals — so a
// before/after comparison faces exactly the same trips.

import type { DemandPreset, DemandPresetId, RoadNetwork, SimConfig, Zone } from './types';
import { VehicleKind } from './types';
import { Rng, pickWeighted } from './rng';

export const DEMAND_PRESETS: Record<DemandPresetId, DemandPreset> = {
  low: { id: 'low', label: 'Off-peak', rateFactor: 0.35, busShare: 0.03, bikeShare: 0.04 },
  normal: { id: 'normal', label: 'Normal', rateFactor: 0.7, busShare: 0.03, bikeShare: 0.04 },
  rush: { id: 'rush', label: 'Rush hour', rateFactor: 1.0, busShare: 0.03, bikeShare: 0.04 },
  event: { id: 'event', label: 'Special event', rateFactor: 1.3, busShare: 0.03, bikeShare: 0.04 },
};

export interface Trip {
  id: number;
  /** departure time, s */
  t: number;
  /** index into the resolved zone list */
  oZone: number;
  dZone: number;
  oNode: string;
  dNode: string;
  /** requested kind (bikes fall back to cars at spawn if no bike route exists) */
  kind: VehicleKind;
  /** multiplier on the speed limit for desired speed */
  speedFactor: number;
  /** multiplier on the time headway T */
  headwayFactor: number;
  /** multiplier on max acceleration */
  accelFactor: number;
  /** MOBIL politeness */
  politeness: number;
}

/** Zones to use: the network's own, or one implicit zone per boundary node. */
export function resolveZones(net: RoadNetwork): Zone[] {
  if (net.zones && net.zones.length > 0) return net.zones;
  return net.nodes.filter((n) => n.kind === 'boundary').map((n) => ({ id: n.id, name: n.name ?? n.id, nodes: [n.id] }));
}

/** OD pairs with weights, in deterministic zone order. */
export function odPairs(net: RoadNetwork, preset: DemandPreset, zones: Zone[]): { o: number; d: number; w: number }[] {
  const table = net.od?.[preset.id] ?? preset.od;
  const pairs: { o: number; d: number; w: number }[] = [];
  if (table) {
    zones.forEach((zo, oi) => {
      const row = table[zo.id];
      if (!row) return;
      zones.forEach((zd, di) => {
        const w = row[zd.id] ?? 0;
        if (oi === di && zo.nodes.length < 2) return;
        if (w > 0) pairs.push({ o: oi, d: di, w });
      });
    });
  }
  if (pairs.length === 0) {
    zones.forEach((zo, oi) =>
      zones.forEach((zd, di) => {
        if (oi !== di && zo.nodes.length > 0 && zd.nodes.length > 0) pairs.push({ o: oi, d: di, w: 1 });
      }),
    );
  }
  if (pairs.length === 0 && zones.length === 1 && zones[0].nodes.length > 1) pairs.push({ o: 0, d: 0, w: 1 });
  return pairs;
}

/**
 * Precompute every trip of the run. Uses two independent RNG streams:
 * `trips` (times, OD, nodes, kind — fixed 5 draws per trip) and `drivers`
 * (driver parameters — fixed 4 draws per trip).
 */
export function generateTrips(net: RoadNetwork, config: SimConfig): Trip[] {
  const preset = DEMAND_PRESETS[config.demand] ?? DEMAND_PRESETS.normal;
  const zones = resolveZones(net);
  const pairs = odPairs(net, preset, zones);
  const trips: Trip[] = [];
  const rate = (config.spawnRate * preset.rateFactor) / 3600; // veh/s
  if (!(rate > 0) || pairs.length === 0) return trips;
  const weights = pairs.map((p) => p.w);
  const total = weights.reduce((a, b) => a + b, 0);
  const tr = Rng.stream(config.seed, 'trips');
  const dr = Rng.stream(config.seed, 'drivers');
  let t = 0;
  for (let id = 0; ; id++) {
    t += tr.exp(rate);
    const uOd = tr.next(), uO = tr.next(), uD = tr.next(), uK = tr.next();
    if (t >= config.duration) break;
    const p = pairs[pickWeighted(weights, total, uOd)];
    const zo = zones[p.o], zd = zones[p.d];
    const oNode = zo.nodes[Math.min(zo.nodes.length - 1, Math.floor(uO * zo.nodes.length))];
    let di = Math.min(zd.nodes.length - 1, Math.floor(uD * zd.nodes.length));
    if (zd.nodes[di] === oNode && zd.nodes.length > 1) di = (di + 1) % zd.nodes.length;
    const dNode = zd.nodes[di];
    const kind = uK < preset.busShare ? VehicleKind.Bus : uK < preset.busShare + preset.bikeShare ? VehicleKind.Bike : VehicleKind.Car;
    // driver parameters: roughly triangular around 1
    const sf = 0.88 + 0.12 * (dr.next() + dr.next()); // 0.88 .. 1.12
    const hf = 0.8 + 0.4 * dr.next();
    const af = 0.85 + 0.3 * dr.next();
    trips.push({ id, t, oZone: p.o, dZone: p.d, oNode, dNode, kind, speedFactor: sf, headwayFactor: hf, accelFactor: af, politeness: 0.3 });
  }
  return trips;
}
