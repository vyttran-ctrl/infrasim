import { describe, expect, it } from 'vitest';
import { buildGrid } from './index';
import { networkProblems, stronglyConnected } from './testUtil';

describe('buildGrid', () => {
  const net = buildGrid();

  it('has the expected size', () => {
    expect(net.nodes.filter((n) => n.kind === 'signal')).toHaveLength(16);
    expect(net.nodes.filter((n) => n.kind === 'boundary')).toHaveLength(16);
    expect(net.nodes).toHaveLength(32);
    expect(net.edges).toHaveLength(80); // 40 two-way street segments
    expect(net.signals).toHaveLength(16);
  });

  it('is structurally sound (ids, lengths, pairs, signal plans)', () => {
    expect(networkProblems(net)).toEqual([]);
    for (const e of net.edges) expect(e.pairId).toBeDefined();
  });

  it('is strongly connected', () => {
    expect(stronglyConnected(net)).toBe(true);
  });

  it('blocks are irregular and plausibly sized', () => {
    const inner = net.edges.filter((e) => /^[a-z]+_[123]$/.test(e.id));
    expect(inner).toHaveLength(24);
    const lens = inner.map((e) => e.length);
    expect(Math.min(...lens)).toBeGreaterThan(200);
    expect(Math.max(...lens)).toBeLessThan(290);
    expect(new Set(lens.map((l) => Math.round(l))).size).toBeGreaterThan(10);
  });

  it('has a key arterial × arterial junction', () => {
    const into = net.edges.filter((e) => e.to === 'n11');
    expect(into).toHaveLength(4);
    expect(into.every((e) => e.roadClass === 'arterial' && e.lanes === 2)).toBe(true);
    expect(new Set(net.edges.map((e) => e.roadClass))).toEqual(new Set(['arterial', 'collector', 'local']));
  });

  it('zones and OD', () => {
    expect(net.zones.map((z) => z.name)).toEqual(['Residential', 'Campus', 'Downtown', 'Industrial']);
    for (const z of net.zones) {
      expect(z.nodes.length).toBeGreaterThan(0);
      expect(z.color).toBeUndefined();
    }
    expect(new Set(net.zones.flatMap((z) => z.nodes)).size).toBe(16);
    for (const p of ['low', 'normal', 'rush', 'event'] as const) expect(net.od?.[p]).toBeDefined();
    const rush = net.od!.rush!;
    expect(rush.residential.campus).toBeGreaterThan(rush.campus.residential * 3);
    const event = net.od!.event!;
    expect(event.downtown.campus).toBeGreaterThan(event.downtown.residential);
    expect(net.nodes.filter((n) => n.pedCrossing).length).toBeGreaterThanOrEqual(2);
  });

  it('arterial phases get the longer green', () => {
    const p = net.signals.find((s) => s.nodeId === 'n12')!; // University (arterial) × Albert (local)
    const uni = p.phases.find((ph) => ph.greenEdges.some((id) => id.startsWith('uni')))!;
    const alb = p.phases.find((ph) => ph.greenEdges.some((id) => id.startsWith('alb')))!;
    expect(uni.green).toBeGreaterThan(alb.green);
    expect(p.pedPhase).toBeGreaterThan(0);
  });
});
