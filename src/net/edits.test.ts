import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../sim/types';
import {
  addRoad,
  buildGrid,
  checkConnectivity,
  defaultSignalPlan,
  edgeLabel,
  nodeLabel,
  setBikeLane,
  setBusLanes,
  setCapacity,
  setEdgeClosed,
  setLanes,
  setNodeKind,
  setOneWay,
  setPedCrossing,
  setPedPhase,
  setSignalTiming,
  setSpeedLimit,
  setTwoWay,
} from './index';
import { networkProblems } from './testUtil';

const grid = buildGrid();
const edge = (net: RoadNetwork, id: string) => net.edges.find((e) => e.id === id)!;
const plan = (net: RoadNetwork, id: string) => net.signals.find((p) => p.nodeId === id)!;

describe('edits', () => {
  it('never mutates the input', () => {
    const before = JSON.stringify(grid);
    setEdgeClosed(grid, 'uni_2', true);
    setLanes(grid, 'uni_2', 4);
    setOneWay(grid, 'uni_2');
    setTwoWay(setOneWay(grid, 'uni_2'), 'uni_2');
    addRoad(grid, 'n00', 'n11');
    setNodeKind(grid, 'n11', 'roundabout');
    setSignalTiming(grid, 'n11', 0, { green: 50 });
    setPedCrossing(grid, 'n11', true);
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('closing an edge closes both directions by default', () => {
    const net = setEdgeClosed(grid, 'uni_2', true);
    expect(edge(net, 'uni_2').closed).toBe(true);
    expect(edge(net, 'uni_2_r').closed).toBe(true);
    const one = setEdgeClosed(grid, 'uni_2', true, false);
    expect(edge(one, 'uni_2').closed).toBe(true);
    expect(edge(one, 'uni_2_r').closed).toBe(false);
    expect(networkProblems(net)).toEqual([]);
    const reopened = setEdgeClosed(net, 'uni_2_r', false);
    expect(edge(reopened, 'uni_2').closed).toBe(false);
  });

  it('setLanes clamps and keeps a general lane', () => {
    expect(edge(setLanes(grid, 'uni_2', 9), 'uni_2').lanes).toBe(6);
    expect(edge(setLanes(grid, 'uni_2', 0), 'uni_2').lanes).toBe(1);
    let net = setLanes(grid, 'uni_2', 3);
    net = setBusLanes(net, 'uni_2', 1);
    net = setBikeLane(net, 'uni_2', true, false);
    expect(edge(net, 'uni_2')).toMatchObject({ lanes: 3, busLanes: 1, bikeLane: true });
    net = setLanes(net, 'uni_2', 1);
    const e = edge(net, 'uni_2');
    expect(e.lanes).toBe(1);
    expect(e.lanes - e.busLanes - (e.bikeLane ? 1 : 0)).toBeGreaterThanOrEqual(1);
    expect(edge(setBusLanes(grid, 'uni_2', 5), 'uni_2').busLanes).toBe(1);
  });

  it('capacity and speed', () => {
    expect(edge(setCapacity(grid, 'uni_2', 1500), 'uni_2').capacity).toBe(1500);
    const net = setSpeedLimit(grid, 'uni_2', 11.1);
    expect(edge(net, 'uni_2').speedLimit).toBe(11.1);
    expect(edge(net, 'uni_2_r').speedLimit).toBe(11.1);
  });

  it('setOneWay / setTwoWay round-trip', () => {
    const one = setOneWay(grid, 'uni_2');
    expect(one.edges.find((e) => e.id === 'uni_2_r')).toBeUndefined();
    expect(edge(one, 'uni_2').pairId).toBeUndefined();
    expect(one.edges.length).toBe(grid.edges.length - 1);
    expect(networkProblems(one)).toEqual([]);
    const two = setTwoWay(one, 'uni_2');
    expect(two.edges.length).toBe(grid.edges.length);
    const f = edge(two, 'uni_2');
    const r = two.edges.find((e) => e.id === f.pairId)!;
    expect(r.from).toBe(f.to);
    expect(r.to).toBe(f.from);
    expect(r.lanes).toBe(f.lanes);
    expect(r.length).toBeCloseTo(f.length, 6);
    expect(networkProblems(two)).toEqual([]);
    // the recreated approach is back in a phase at its signal
    expect(plan(two, r.to).phases.some((ph) => ph.greenEdges.includes(r.id))).toBe(true);
  });

  it('addRoad adds edges and signal plan entries', () => {
    const { network, edgeIds } = addRoad(grid, 'n00', 'n11', { lanes: 1, name: 'Diagonal Rd' });
    expect(edgeIds).toHaveLength(2);
    expect(network.edges.length).toBe(grid.edges.length + 2);
    const [f, r] = edgeIds.map((id) => edge(network, id));
    expect(f.pairId).toBe(r.id);
    expect(f.name).toBe('Diagonal Rd');
    expect(f.length).toBeGreaterThan(300);
    expect(plan(network, 'n11').phases.some((ph) => ph.greenEdges.includes(f.id))).toBe(true);
    expect(plan(network, 'n00').phases.some((ph) => ph.greenEdges.includes(r.id))).toBe(true);
    expect(networkProblems(network)).toEqual([]);
    const oneWay = addRoad(grid, 'n00', 'n11', { twoWay: false });
    expect(oneWay.edgeIds).toHaveLength(1);
    expect(addRoad(grid, 'n00', 'n00').edgeIds).toHaveLength(0);
  });

  it('node kind changes create and remove plans', () => {
    const rb = setNodeKind(grid, 'n11', 'roundabout');
    expect(rb.signals.find((p) => p.nodeId === 'n11')).toBeUndefined();
    expect(rb.nodes.find((n) => n.id === 'n11')!.kind).toBe('roundabout');
    const back = setNodeKind(rb, 'n11', 'signal');
    expect(plan(back, 'n11').phases).toHaveLength(2);
    expect(networkProblems(back)).toEqual([]);
    expect(setNodeKind(grid, 'bW0', 'signal')).toBe(grid);
  });

  it('signal timing and ped phase', () => {
    let net = setSignalTiming(grid, 'n11', 1, { green: 40, yellow: 5 });
    expect(plan(net, 'n11').phases[1]).toMatchObject({ green: 40, yellow: 5 });
    net = setPedPhase(net, 'n11', 15);
    expect(plan(net, 'n11').pedPhase).toBe(15);
    expect(net.nodes.find((n) => n.id === 'n11')!.pedCrossing).toBe(true);
    net = setPedCrossing(net, 'n11', false);
    expect(plan(net, 'n11').pedPhase).toBe(0);
    expect(net.nodes.find((n) => n.id === 'n11')!.pedCrossing).toBe(false);
  });

  it('defaultSignalPlan groups opposing approaches', () => {
    const p = defaultSignalPlan(grid, 'n11');
    expect(p.phases.map((ph) => ph.name).sort()).toEqual(['East/West', 'North/South']);
    const ew = p.phases.find((ph) => ph.name === 'East/West')!;
    expect(ew.greenEdges.slice().sort()).toEqual(['uni_1', 'uni_2_r'].sort());
    expect(p.phases[0]).toMatchObject({ green: 30, yellow: 4, allRed: 2 });
    expect(p.phases[1].green).toBe(25);
    // T junction: King St north of n11 becomes one-way northbound (no approach from the north)
    const t = setOneWay(grid, 'kng_1_r');
    const tp = defaultSignalPlan(t, 'n11');
    expect(tp.phases).toHaveLength(2);
    expect(tp.phases.flatMap((ph) => ph.greenEdges).sort()).toEqual(
      t.edges.filter((e) => e.to === 'n11').map((e) => e.id).sort(),
    );
  });

  it('checkConnectivity detects a cut', () => {
    expect(checkConnectivity(grid)).toEqual({ ok: true, unreachable: [] });
    // cut the Industrial zone off: close the three southern stubs
    let net = grid;
    for (const k of ['wmt', 'kng', 'alb']) net = setEdgeClosed(net, `${k}_4`, true);
    const res = checkConnectivity(net);
    expect(res.ok).toBe(false);
    expect(res.unreachable).toContainEqual({ from: 'Industrial', to: 'Campus' });
    expect(res.unreachable).toContainEqual({ from: 'Residential', to: 'Industrial' });
    expect(res.unreachable).not.toContainEqual({ from: 'Residential', to: 'Campus' });
  });

  it('labels', () => {
    expect(edgeLabel(grid, 'uni_2')).toBe('University Ave (eastbound)');
    expect(edgeLabel(grid, 'uni_2_r')).toBe('University Ave (westbound)');
    expect(edgeLabel(grid, 'kng_1')).toBe('King St (southbound)');
    expect(nodeLabel(grid, 'n11')).toBe('University Ave & King St');
    expect(nodeLabel(grid, 'n22')).toMatch(/^(Erb St & Albert St|Albert St & Erb St)$/);
    expect(nodeLabel(grid, 'bW1')).toBe('University Ave (west end)');
  });

  it('random edit sequences keep the network consistent', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    for (let run = 0; run < 25; run++) {
      let net = buildGrid();
      for (let step = 0; step < 40; step++) {
        const e = pick(net.edges);
        const n = pick(net.nodes.filter((x) => x.kind !== 'boundary'));
        switch (Math.floor(rnd() * 12)) {
          case 0: net = setEdgeClosed(net, e.id, rnd() < 0.5); break;
          case 1: net = setLanes(net, e.id, Math.floor(rnd() * 8)); break;
          case 2: net = setOneWay(net, e.id); break;
          case 3: net = setTwoWay(net, e.id); break;
          case 4: net = addRoad(net, n.id, pick(net.nodes).id, { twoWay: rnd() < 0.7 }).network; break;
          case 5: net = setNodeKind(net, n.id, pick(['signal', 'priority', 'roundabout'] as const)); break;
          case 6: net = setBusLanes(net, e.id, Math.floor(rnd() * 4)); break;
          case 7: net = setBikeLane(net, e.id, rnd() < 0.6); break;
          case 8: net = setSignalTiming(net, n.id, Math.floor(rnd() * 3), { green: rnd() * 80 }); break;
          case 9: net = setPedPhase(net, n.id, rnd() * 30); break;
          case 10: net = setPedCrossing(net, n.id, rnd() < 0.5); break;
          default: net = setSpeedLimit(net, e.id, rnd() * 30); break;
        }
        const problems = networkProblems(net);
        if (problems.length) throw new Error(`run ${run} step ${step}: ${problems.join('; ')}`);
      }
    }
  });
});
