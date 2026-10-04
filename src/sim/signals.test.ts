import { describe, expect, it } from 'vitest';
import { compileSignal, signalState } from './signals';
import { Simulation } from './engine';
import { crossroad, testConfig } from './testNetworks';
import { Aspect } from './types';

describe('signals', () => {
  it('cycles green → yellow → allRed per phase, then the ped phase', () => {
    const plan = {
      nodeId: 'C',
      offset: 0,
      pedPhase: 10,
      phases: [
        { name: 'NS', greenEdges: ['a'], green: 20, yellow: 3, allRed: 2 },
        { name: 'EW', greenEdges: ['b'], green: 15, yellow: 3, allRed: 2 },
      ],
    };
    const sig = compileSignal(plan, new Map([['a', 0], ['b', 1]]), [0, 1])!;
    expect(sig.cycle).toBe(55);
    expect(signalState(sig, 5)).toMatchObject({ phase: 0, stage: 'green' });
    expect(signalState(sig, 21)).toMatchObject({ phase: 0, stage: 'yellow' });
    expect(signalState(sig, 24)).toMatchObject({ phase: 0, stage: 'allRed' });
    expect(signalState(sig, 26)).toMatchObject({ phase: 1, stage: 'green' });
    expect(signalState(sig, 50)).toMatchObject({ phase: -1, stage: 'ped' });
    expect(signalState(sig, 55 + 5)).toMatchObject({ phase: 0, stage: 'green' });
  });

  it('no vehicle crosses a red stop line', () => {
    const sim = new Simulation(crossroad(), testConfig({ demand: 'rush', duration: 900 }));
    const approaches = ['N_C', 'S_C', 'E_C', 'W_C'].map((id) => sim.edges[sim.edgeIdx.get(id)!]);
    let crossedGreen = 0;
    let crossedRed = 0;
    while (!sim.finished) {
      const before = new Map<number, { e: number; s: number }>();
      for (const v of sim.active) before.set(v.id, { e: v.edge, s: v.s });
      sim.step();
      const live = new Map(sim.active.map((v) => [v.id, v]));
      for (const a of approaches) {
        for (const [id, b] of before) {
          if (b.e !== a.idx || b.s >= a.stopLine) continue;
          const v = live.get(id);
          const crossed = !v || v.edge !== a.idx || v.s >= a.stopLine;
          if (!crossed) continue;
          if (sim.aspects[a.idx] === Aspect.Red) crossedRed++;
          else crossedGreen++;
        }
      }
    }
    expect(crossedGreen).toBeGreaterThan(100);
    expect(crossedRed).toBe(0);
  });

  it('changing green time changes which approach is green', () => {
    const at = (nsGreen: number) => {
      const sim = new Simulation(crossroad({ nsGreen, ewGreen: 25 }), testConfig());
      sim.run(20);
      return { ns: sim.aspects[sim.edgeIdx.get('N_C')!], ew: sim.aspects[sim.edgeIdx.get('E_C')!] };
    };
    expect(at(40)).toEqual({ ns: Aspect.Green, ew: Aspect.Red });
    expect(at(10)).toEqual({ ns: Aspect.Red, ew: Aspect.Green });
  });

  it('exclusive pedestrian phase holds all approaches red and flags pedActive', () => {
    const net = crossroad();
    net.signals[0].pedPhase = 12;
    const sim = new Simulation(net, testConfig());
    sim.run(65); // cycle = 30+30+12; ped phase is 60..72
    const c = sim.nodeIdx.get('C')!;
    expect(sim.pedActive[c]).toBe(1);
    for (const id of ['N_C', 'S_C', 'E_C', 'W_C']) expect(sim.aspects[sim.edgeIdx.get(id)!]).toBe(Aspect.Red);
  });
});
