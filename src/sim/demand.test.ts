import { describe, expect, it } from 'vitest';
import { DEMAND_PRESETS, generateTrips } from './demand';
import { Simulation } from './engine';
import { cloneNet, grid, testConfig } from './testNetworks';
import { VehicleKind } from './types';

describe('demand', () => {
  it('presets', () => {
    expect(DEMAND_PRESETS.low.rateFactor).toBe(0.35);
    expect(DEMAND_PRESETS.normal.rateFactor).toBe(0.7);
    expect(DEMAND_PRESETS.rush.rateFactor).toBe(1.0);
    expect(DEMAND_PRESETS.event.rateFactor).toBe(1.3);
  });

  it('trip list is identical for the same seed regardless of network edits', () => {
    const net = grid(3, 3);
    const cfg = testConfig({ seed: 42, duration: 1800 });
    const base = generateTrips(net, cfg);
    const edited = cloneNet(net);
    edited.edges[3].closed = true;
    edited.edges[5].lanes = 4;
    edited.edges[7].bikeLane = true;
    edited.edges[8].speedLimit = 5;
    edited.signals[0].phases[0].green = 60;
    edited.nodes[4].kind = 'roundabout';
    expect(generateTrips(edited, cfg)).toEqual(base);
    expect(new Simulation(edited, cfg).trips).toEqual(new Simulation(net, cfg).trips);
    // a live edit does not alter the trip list either
    const sim = new Simulation(net, cfg);
    sim.run(100);
    sim.applyEdit(edited);
    expect(sim.trips).toEqual(base);
  });

  it('different seeds give different trips; rate and shares are as configured', () => {
    const net = grid(3, 3);
    const a = generateTrips(net, testConfig({ seed: 1, duration: 3600, demand: 'rush', spawnRate: 3600 }));
    const b = generateTrips(net, testConfig({ seed: 2, duration: 3600, demand: 'rush', spawnRate: 3600 }));
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(3400);
    expect(a.length).toBeLessThan(3800);
    const buses = a.filter((t) => t.kind === VehicleKind.Bus).length / a.length;
    const bikes = a.filter((t) => t.kind === VehicleKind.Bike).length / a.length;
    expect(buses).toBeGreaterThan(0.015);
    expect(buses).toBeLessThan(0.05);
    expect(bikes).toBeGreaterThan(0.02);
    expect(bikes).toBeLessThan(0.06);
    for (const t of a) expect(t.oZone).not.toBe(t.dZone);
    const low = generateTrips(net, testConfig({ seed: 1, duration: 3600, demand: 'low' }));
    expect(low.length / a.length).toBeGreaterThan(0.28);
    expect(low.length / a.length).toBeLessThan(0.42);
  });

  it('uses network OD weights when present', () => {
    const net = cloneNet(grid(3, 3));
    net.od = { event: { N: { S: 1 }, E: { S: 3 } } };
    const trips = generateTrips(net, testConfig({ demand: 'event', duration: 3600 }));
    const zones = net.zones.map((z) => z.id);
    expect(trips.every((t) => zones[t.dZone] === 'S')).toBe(true);
    const fromE = trips.filter((t) => zones[t.oZone] === 'E').length / trips.length;
    expect(fromE).toBeGreaterThan(0.68);
    expect(fromE).toBeLessThan(0.82);
  });
});
