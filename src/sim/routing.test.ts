import { describe, expect, it } from 'vitest';
import { buildGraph, routeOnNetwork, shortestPath } from './graph';
import { cloneNet, disconnected, grid, parallelRoutes } from './testNetworks';
import { VehicleKind } from './types';

describe('routing', () => {
  it('finds the shortest path', () => {
    const net = grid(3, 3);
    expect(routeOnNetwork(net, 'W0', 'E0')).toEqual(['W0_J0_0', 'J0_0_J1_0', 'J1_0_J2_0', 'J2_0_E0']);
    expect(routeOnNetwork(parallelRoutes(), 'W', 'E')).toEqual(['W_A', 'A_B', 'B_E']);
  });

  it('avoids a closed edge', () => {
    const net = cloneNet(parallelRoutes());
    net.edges.find((e) => e.id === 'A_B')!.closed = true;
    expect(routeOnNetwork(net, 'W', 'E')).toEqual(['W_A', 'A_C', 'C_D', 'D_B', 'B_E']);
    const g = cloneNet(grid(3, 3));
    g.edges.find((e) => e.id === 'J1_0_J2_0')!.closed = true;
    const r = routeOnNetwork(g, 'W0', 'E0')!;
    expect(r).not.toBeNull();
    expect(r).not.toContain('J1_0_J2_0');
    expect(r[0]).toBe('W0_J0_0');
    expect(r[r.length - 1]).toBe('J2_0_E0');
  });

  it('returns null when disconnected', () => {
    expect(routeOnNetwork(disconnected(), 'A', 'C')).toBeNull();
    expect(routeOnNetwork(disconnected(), 'A', 'B')).toEqual(['A_B']);
  });

  it('excludes edges without a usable lane for the kind', () => {
    const net = cloneNet(parallelRoutes());
    expect(routeOnNetwork(net, 'W', 'E', VehicleKind.Bike)).toBeNull();
    for (const e of net.edges) e.bikeLane = true;
    expect(routeOnNetwork(net, 'W', 'E', VehicleKind.Bike)).toEqual(['W_A', 'A_B', 'B_E']);
    // A_B fully converted to bus lanes: cars detour, buses don't
    for (const e of net.edges) e.bikeLane = false;
    const ab = net.edges.find((e) => e.id === 'A_B')!;
    ab.busLanes = 2;
    expect(routeOnNetwork(net, 'W', 'E', VehicleKind.Car)).toContain('C_D');
    expect(routeOnNetwork(net, 'W', 'E', VehicleKind.Bus)).toContain('A_B');
  });

  it('A* agrees with Dijkstra', () => {
    const net = grid(4, 4);
    const g = buildGraph(net);
    const cost = (i: number) => net.edges[i].length / net.edges[i].speedLimit + (i % 7);
    const ni = new Map(net.nodes.map((n, i) => [n.id, i]));
    for (const [a, b] of [['W0', 'E3'], ['S0', 'N3'], ['N1', 'W2']]) {
      const p1 = shortestPath(g, ni.get(a)!, ni.get(b)!, cost)!;
      const p2 = shortestPath(g, ni.get(a)!, ni.get(b)!, cost, Infinity)!;
      const sum = (p: number[]) => p.reduce((s, e) => s + cost(e), 0);
      expect(sum(p1)).toBeCloseTo(sum(p2), 6);
    }
  });
});
