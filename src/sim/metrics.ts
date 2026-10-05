// Metric accumulation and the MetricsSummary definition.
//
// Definitions (all per run, sim time t):
//  avgTravelTime     mean over completed trips of (arrival − scheduled departure);
//                    includes time waiting in the origin queue.
//  avgSpeed          total distance driven / total vehicle-seconds on the network.
//  avgDelay          mean over completed trips of travel time − free-flow time of
//                    the path actually driven (Σ ds / min(speedLimit, kind v0)).
//  intersectionDelay mean over completed trips of seconds spent at < 2 m/s within
//                    40 m of the end of an edge.
//  throughput        completed trips per hour of simulated time.
//  queue (per edge)  vehicles with speed < 2 m/s on an approach edge (an edge
//                    ending at a non-boundary node).
//  avgQueue          time-average of the MEAN queue over all approach edges.
//  maxQueue          largest single-edge queue seen at any step.
//  utilization       per edge: 0.65·density + 0.35·(1 − speed ratio)·min(1, 5·density),
//                    density = vehicles / (lanes·length/7.5 m), clamped 0..1.
//                    Summary value = mean over edges of the run-average utilization.
//  hotspots          edges whose 60 s-smoothed utilization > 0.85 or smoothed
//                    queue > 10, worst first, top 10.
//  congestedRoads    edges whose 60 s-smoothed utilization > 0.7.
//  fuel              speed-dependent L/100 km curve + acceleration term + idling.
//  co2               2.31 kg per litre.

import type { MetricsSample, MetricsSummary } from './types';
import { VehicleKind } from './types';
import type { EdgeRT, Veh } from './runtime';

export const CO2_PER_L = 2.31;
export const SERIES_INTERVAL = 30;

/** Fuel consumption in litres per second. */
export function fuelRate(kind: VehicleKind, v: number, a: number): number {
  if (kind === VehicleKind.Bike) return 0;
  const bus = kind === VehicleKind.Bus;
  if (v < 0.5) return (bus ? 3.0 : 0.8) / 3600; // idling, L/h
  const kmh = v * 3.6;
  const per100 = 3.2 + 160 / Math.max(5, kmh) + 0.0005 * kmh * kmh;
  let rate = (v * per100) / 100000;
  if (a > 0) rate += ((bus ? 12000 : 1500) * a * v) / 8e6; // ~8 MJ useful work per litre
  return bus ? rate * 3.5 : rate;
}

export class MetricsCollector {
  spawned = 0;
  completed = 0;
  sumTravel = 0;
  sumDelay = 0;
  sumIntDelay = 0;
  /** metres */
  dist = 0;
  vehTime = 0;
  fuel = 0;
  reroutes = 0;
  unroutable = 0;
  queueAcc = 0;
  maxQueue = 0;
  series: MetricsSample[] = [];

  complete(v: Veh, now: number) {
    const tt = now - v.spawnT;
    this.completed++;
    this.sumTravel += tt;
    this.sumDelay += tt - v.freeFlow;
    this.sumIntDelay += v.intDelay;
  }

  summary(t: number, active: number, edges: EdgeRT[]): MetricsSummary {
    const c = this.completed;
    let utilSum = 0;
    let congested = 0;
    const hot: { id: string; score: number }[] = [];
    for (const e of edges) {
      const st = e.stats;
      utilSum += t > 0 ? st.utilTime / t : 0;
      if (st.utilSlow > 0.7) congested++;
      if (st.utilSlow > 0.85 || st.queueSlow > 10) hot.push({ id: e.id, score: Math.max(st.utilSlow, st.queueSlow / 10) });
    }
    hot.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return {
      simTime: t,
      spawned: this.spawned,
      completedTrips: c,
      active,
      avgTravelTime: c ? this.sumTravel / c : 0,
      avgSpeed: this.vehTime > 0 ? this.dist / this.vehTime : 0,
      avgDelay: c ? this.sumDelay / c : 0,
      intersectionDelay: c ? this.sumIntDelay / c : 0,
      throughput: t > 0 ? c / (t / 3600) : 0,
      avgQueue: t > 0 ? this.queueAcc / t : 0,
      maxQueue: this.maxQueue,
      utilization: edges.length ? utilSum / edges.length : 0,
      hotspots: hot.slice(0, 10).map((h) => h.id),
      congestedRoads: congested,
      distance: this.dist / 1000,
      reroutes: this.reroutes,
      fuel: this.fuel,
      co2: this.fuel * CO2_PER_L,
      unroutable: this.unroutable,
      series: this.series.slice(),
    };
  }
}
