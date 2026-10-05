import { describe, expect, it } from 'vitest';
import { Simulation } from './engine';
import { RING_CAP } from './junction';
import { laneAllowed } from './idm';
import { cloneNet, corridor, crossroad, disconnected, grid, parallelRoutes, roundabout, testConfig } from './testNetworks';
import { EDGE_STRIDE, VEH_STRIDE, VehicleKind, type RoadNetwork, type SimConfig } from './types';

function runAll(net: RoadNetwork, cfg: Partial<SimConfig>) {
  const sim = new Simulation(net, testConfig(cfg));
  while (!sim.finished) sim.step();
  return sim;
}

function closeEdges(net: RoadNetwork, ids: string[]): RoadNetwork {
  const n = cloneNet(net);
  for (const e of n.edges) if (ids.includes(e.id)) e.closed = true;
  return n;
}

describe('engine basics', () => {
  it('trips reach their destinations', () => {
    const sim = runAll(crossroad(), { demand: 'low', duration: 600 });
    const m = sim.summary();
    expect(m.completedTrips).toBeGreaterThan(150);
    expect(m.completedTrips + m.active).toBe(m.spawned);
    expect(m.unroutable).toBe(0);
    expect(m.avgTravelTime).toBeGreaterThan(30); // 500 m at ≤ 13.9 m/s
    expect(m.avgDelay).toBeGreaterThan(0);
    expect(m.series.length).toBe(20);
    expect(m.fuel).toBeGreaterThan(0);
    expect(m.co2).toBeCloseTo(m.fuel * 2.31, 6);
  });

  it('trips can start and end at interior junctions', () => {
    const net = cloneNet(crossroad({ kind: 'priority' }));
    net.zones = [
      { id: 'mid', name: 'Centre', nodes: ['C'] },
      { id: 'N', name: 'N', nodes: ['N'] },
      { id: 'S', name: 'S', nodes: ['S'] },
    ];
    const sim = runAll(net, { demand: 'normal', duration: 600 });
    const m = sim.summary();
    expect(m.unroutable).toBe(0);
    expect(m.completedTrips).toBeGreaterThan(200);
    const mid = sim.trips.filter((t) => t.oZone === 0 || t.dZone === 0).length;
    expect(mid).toBeGreaterThan(50);
  });

  it('unroutable trips are counted and dropped', () => {
    const sim = runAll(disconnected(), { demand: 'low', duration: 300 });
    const m = sim.summary();
    expect(m.completedTrips).toBe(0);
    expect(m.unroutable).toBe(sim.trips.length);
  });

  it('respects maxVehicles and produces well-formed frames', () => {
    const sim = new Simulation(grid(3, 3), testConfig({ maxVehicles: 60, spawnRate: 20000, duration: 300 }));
    let peak = 0;
    while (!sim.finished) {
      sim.step();
      peak = Math.max(peak, sim.active.length);
    }
    expect(peak).toBe(60);
    expect(sim.originQueueLength()).toBeGreaterThan(0);
    const f = sim.frame(false);
    expect(f.count).toBe(sim.active.length);
    expect(f.vehicles.length).toBe(f.count * VEH_STRIDE);
    expect(f.edgeStats.length).toBe(sim.edges.length * EDGE_STRIDE);
    expect(f.aspects.length).toBe(sim.edges.length);
    expect(f.pedActive.length).toBe(sim.nodes.length);
    for (let i = 0; i < f.vehicles.length; i++) expect(Number.isFinite(f.vehicles[i])).toBe(true);
    expect(f.finished).toBe(true);
  });

  it('is deterministic: same seed ⇒ identical summary (also across live edits)', () => {
    const run = () => {
      const sim = new Simulation(grid(3, 3), testConfig({ demand: 'rush', duration: 600, seed: 7 }));
      sim.run(200);
      sim.applyEdit(closeEdges(sim.network, ['J1_1_J2_1', 'J2_1_J1_1']));
      while (!sim.finished) sim.step();
      return JSON.stringify(sim.summary()) + JSON.stringify(Array.from(sim.frame(false).vehicles));
    };
    expect(run()).toBe(run());
    const a = runAll(grid(3, 3), { seed: 7, duration: 300 }).summary();
    const b = runAll(grid(3, 3), { seed: 8, duration: 300 }).summary();
    expect(a).not.toEqual(b);
  });

  it('more lanes ⇒ higher throughput under saturation', () => {
    const one = runAll(corridor({ lanes: 1 }), { demand: 'rush', duration: 900 }).summary();
    const two = runAll(corridor({ lanes: 2 }), { demand: 'rush', duration: 900 }).summary();
    expect(two.throughput).toBeGreaterThan(one.throughput * 1.4);
  });

  it('roundabouts and priority junctions move traffic', () => {
    const rb = new Simulation(roundabout(), testConfig({ demand: 'normal', duration: 600 }));
    const c = rb.nodeIdx.get('C')!;
    let maxRing = 0;
    while (!rb.finished) {
      rb.step();
      maxRing = Math.max(maxRing, rb.nodes[c].ring.length);
    }
    expect(rb.summary().completedTrips).toBeGreaterThan(250);
    expect(maxRing).toBeGreaterThan(0);
    expect(maxRing).toBeLessThanOrEqual(RING_CAP + 2);
    const pr = runAll(grid(3, 3, { signals: false }), { demand: 'normal', duration: 600 }).summary();
    expect(pr.completedTrips).toBeGreaterThan(250);
  });

  it('pedestrian crossings at a priority node block periodically', () => {
    const sim = new Simulation(crossroad({ kind: 'priority', pedCrossing: true }), testConfig({ duration: 600 }));
    const c = sim.nodeIdx.get('C')!;
    let on = 0;
    while (!sim.finished) {
      sim.step();
      on += sim.pedActive[c];
    }
    const frac = on / sim.stepCount;
    expect(frac).toBeGreaterThan(0.03);
    expect(frac).toBeLessThan(0.3);
  });

  it('bikes ride only on bike lanes, cars never use bike or bus lanes', () => {
    const net = cloneNet(crossroad({ lanes: 3 }));
    for (const e of net.edges) {
      e.bikeLane = true;
      e.busLanes = 1;
    }
    const sim = new Simulation(net, testConfig({ demand: 'rush', duration: 600 }));
    const seen = new Set<VehicleKind>();
    let bad = 0;
    while (!sim.finished) {
      sim.step();
      for (const v of sim.active) {
        if (v.edge < 0) continue;
        seen.add(v.kind);
        if (!laneAllowed(sim.edges[v.edge].lanes[v.lane].type, v.kind)) bad++;
      }
    }
    expect(seen.has(VehicleKind.Bike)).toBe(true);
    expect(seen.has(VehicleKind.Bus)).toBe(true);
    expect(bad).toBe(0);
  });

  it('a road closure in a running sim triggers reroutes and no new entries', () => {
    const sim = new Simulation(parallelRoutes(), testConfig({ demand: 'rush', duration: 900 }));
    sim.run(200);
    const before = sim.edgeEntries('A_B');
    sim.applyEdit(closeEdges(sim.network, ['A_B', 'B_A']));
    expect(sim.summary().reroutes).toBeGreaterThan(0);
    while (!sim.finished) sim.step();
    expect(sim.edgeEntries('A_B')).toBe(before);
    expect(sim.summary().completedTrips).toBeGreaterThan(300); // detour is a 1-lane local road with yields
    expect(sim.summary().unroutable).toBe(0);
  });

  it('runs 1000 vehicles × 300 s quickly', () => {
    const sim = new Simulation(grid(6, 6), testConfig({ spawnRate: 40000, duration: 300, maxVehicles: 1000 }));
    const t0 = performance.now();
    let peak = 0;
    while (!sim.finished) {
      sim.step();
      peak = Math.max(peak, sim.active.length);
    }
    const ms = performance.now() - t0;
    expect(peak).toBe(1000);
    expect(ms).toBeLessThan(5000);
  });
});

describe('scenario behaviour', () => {
  it('(1) higher demand ⇒ longer travel time, larger queue, lower speed', () => {
    const low = runAll(crossroad(), { demand: 'low', duration: 900 }).summary();
    const rush = runAll(crossroad(), { demand: 'rush', duration: 900 }).summary();
    expect(rush.avgTravelTime).toBeGreaterThan(low.avgTravelTime);
    expect(rush.avgQueue).toBeGreaterThan(low.avgQueue);
    expect(rush.avgSpeed).toBeLessThan(low.avgSpeed);
    const gLow = runAll(grid(3, 3), { demand: 'low', duration: 900 }).summary();
    const gHigh = runAll(grid(3, 3), { demand: 'rush', spawnRate: 7000, duration: 900 }).summary();
    expect(gHigh.avgTravelTime).toBeGreaterThan(gLow.avgTravelTime);
    expect(gHigh.avgQueue).toBeGreaterThan(gLow.avgQueue);
    expect(gHigh.avgSpeed).toBeLessThan(gLow.avgSpeed);
  });

  it('(2) closing an important road ⇒ reroutes and traffic shifts to neighbouring roads', () => {
    const base = new Simulation(parallelRoutes(), testConfig({ demand: 'rush', duration: 900 }));
    const closed = new Simulation(parallelRoutes(), testConfig({ demand: 'rush', duration: 900 }));
    base.run(200);
    closed.run(200);
    closed.applyEdit(closeEdges(closed.network, ['A_B', 'B_A']));
    while (!base.finished) base.step();
    while (!closed.finished) closed.step();
    expect(closed.summary().reroutes).toBeGreaterThan(0);
    for (const id of ['A_C', 'C_D', 'D_B', 'B_D', 'D_C', 'C_A']) {
      expect(closed.edgeEntries(id)).toBeGreaterThan(base.edgeEntries(id) + 50);
    }
    expect(closed.summary().avgTravelTime).toBeGreaterThan(base.summary().avgTravelTime);
  });

  it('(3) more green for a direction ⇒ lower delay on its approaches', () => {
    const nsDelay = (nsGreen: number) => {
      const sim = runAll(crossroad({ nsGreen, ewGreen: 25 }), { demand: 'normal', duration: 1200 });
      return {
        ns: (sim.edgeDelay('N_C') + sim.edgeDelay('S_C')) / 2,
        ew: (sim.edgeDelay('E_C') + sim.edgeDelay('W_C')) / 2,
      };
    };
    const short = nsDelay(15);
    const long = nsDelay(40);
    expect(long.ns).toBeLessThan(short.ns);
    expect(long.ew).toBeGreaterThan(short.ew);
  });
});
