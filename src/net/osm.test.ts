import { describe, expect, it } from 'vitest';
import rawWaterloo from '../../scripts/data/waterloo-overpass.json?raw';
import type { RoadNetwork } from '../sim/types';
import { checkConnectivity, loadWaterloo, WATERLOO_BBOX } from './index';
import type { BBox, OverpassElement, OverpassJson } from './osm';
import { bboxSize, convertOverpass, junctionCount, parseMaxspeed } from './osm';
import { networkProblems, stronglyConnected } from './testUtil';
import { applyWaterlooZones } from './waterlooZones';

// A plus-shaped signalized junction (Main St × Cross St), a one-way link,
// and a small roundabout east of the junction with a zebra crossing.
//
//        N            RN
//        |            |
//   30 - 20           40
//   |    |          /    \
//   W -- 10 ---- 1 ---- 43   41 --- E
//                |          \    /
//                21           42
//                |            |
//                S            RS
function fixture(): OverpassJson {
  const node = (id: number, lat: number, lon: number, tags?: Record<string, string>): OverpassElement => ({
    type: 'node', id, lat, lon, ...(tags ? { tags } : {}),
  });
  const way = (id: number, nodes: number[], tags: Record<string, string>): OverpassElement => ({ type: 'way', id, nodes, tags });
  const d = 0.00018; // ring radius ≈ 20 m
  return {
    elements: [
      node(1, 43.0, -80.0, { highway: 'traffic_signals' }),
      node(2, 43.0, -80.009), // W, outside bbox
      node(10, 43.0, -80.004),
      node(20, 43.003, -80.0),
      node(21, 42.997, -80.0),
      node(22, 43.007, -80.0), // N, outside
      node(23, 42.993, -80.0), // S, outside
      node(30, 43.003, -80.004),
      node(40, 43.0 + d, -79.996),
      node(41, 43.0, -79.996 + d * 1.37),
      node(42, 43.0 - d, -79.996),
      node(43, 43.0, -79.996 - d * 1.37),
      node(44, 43.0004, -79.996, { highway: 'crossing' }),
      node(45, 43.007, -79.996), // RN, outside
      node(46, 42.993, -79.996), // RS, outside
      node(47, 43.0, -79.991), // E, outside
      node(99, 43.002, -80.002), // stray node of a tiny disconnected road
      node(98, 43.0021, -80.0021),
      way(100, [2, 10, 1, 43], { highway: 'primary', name: 'Main St', lanes: '4', maxspeed: '50' }),
      way(101, [41, 47], { highway: 'primary', name: 'Main St', lanes: '4', maxspeed: '50' }),
      way(102, [22, 20, 1, 21, 23], { highway: 'secondary', name: 'Cross St', maxspeed: '30 mph' }),
      way(103, [20, 30, 10], { highway: 'tertiary', name: 'Oneway Ave', oneway: 'yes' }),
      way(104, [40, 41, 42, 43, 40], { highway: 'secondary', junction: 'roundabout' }),
      way(105, [45, 44, 40], { highway: 'tertiary', name: 'Ring North Rd' }),
      way(106, [42, 46], { highway: 'tertiary', name: 'Ring South Rd' }),
      way(107, [99, 98], { highway: 'residential', name: 'Lonely Ln' }),
    ],
  };
}
const FIX_BBOX: BBox = { south: 42.995, west: -80.007, north: 43.005, east: -79.993 };

describe('OSM converter (fixture)', () => {
  const net = convertOverpass(fixture(), FIX_BBOX);
  const byName = (name: string) => net.edges.filter((e) => e.name === name);

  it('is structurally sound and strongly connected', () => {
    expect(networkProblems(net)).toEqual([]);
    expect(stronglyConnected(net)).toBe(true);
    expect(net.attribution).toBe('© OpenStreetMap contributors');
    expect(net.geo).toEqual(FIX_BBOX);
  });

  it('finds the signalized plus junction', () => {
    const sig = net.nodes.filter((n) => n.kind === 'signal');
    expect(sig.map((n) => n.id)).toEqual(['n1']);
    const plan = net.signals.find((p) => p.nodeId === 'n1')!;
    expect(plan.phases).toHaveLength(2);
    expect(plan.phases.map((p) => p.name).sort()).toEqual(['East/West', 'North/South']);
    const ew = plan.phases.find((p) => p.name === 'East/West')!;
    for (const id of ew.greenEdges) expect(net.edges.find((e) => e.id === id)!.name).toBe('Main St');
  });

  it('collapses the roundabout ring into one node with its zebra', () => {
    const rb = net.nodes.filter((n) => n.kind === 'roundabout');
    expect(rb).toHaveLength(1);
    expect(Math.hypot(rb[0].x - net.nodes.find((n) => n.id === 'n1')!.x - 324, rb[0].y)).toBeLessThan(15);
    expect(rb[0].pedCrossing).toBe(true);
    expect(net.edges.filter((e) => e.from === rb[0].id || e.to === rb[0].id)).toHaveLength(8);
  });

  it('keeps one-way streets one-way and collapses degree-2 nodes', () => {
    const ow = byName('Oneway Ave');
    expect(ow).toHaveLength(1);
    expect(ow[0].pairId).toBeUndefined();
    expect(ow[0]).toMatchObject({ from: 'n20', to: 'n10' });
    expect(ow[0].points?.length).toBe(1); // the corner node 30
    expect(net.nodes.find((n) => n.id === 'n30')).toBeUndefined();
  });

  it('parses lanes and speeds', () => {
    for (const e of byName('Main St')) {
      expect(e.lanes).toBe(2);
      expect(e.speedLimit).toBeCloseTo(13.9, 1);
      expect(e.roadClass).toBe('arterial');
    }
    for (const e of byName('Cross St')) {
      expect(e.lanes).toBe(1);
      expect(e.speedLimit).toBeCloseTo(13.4, 1);
    }
    expect(parseMaxspeed('40 mph')).toBeCloseTo(17.9, 1);
    expect(parseMaxspeed('CA:urban')).toBeUndefined();
  });

  it('clips at the bbox into boundary nodes and compass zones', () => {
    const b = net.nodes.filter((n) => n.kind === 'boundary');
    expect(b).toHaveLength(6);
    expect(net.zones.map((z) => z.id).sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(net.zones.find((z) => z.id === 'north')!.nodes).toHaveLength(2);
    expect(byName('Lonely Ln')).toHaveLength(0);
    expect(checkConnectivity(net).ok).toBe(true);
    expect(net.od?.rush).toBeDefined();
  });
});

function summary(net: RoadNetwork) {
  return {
    junctions: junctionCount(net),
    signals: net.signals.length,
    names: new Set(net.edges.map((e) => e.name)),
  };
}

describe('OSM converter (Waterloo raw snapshot)', () => {
  const raw = JSON.parse(rawWaterloo) as OverpassJson;
  // Same options as scripts/bake-waterloo.mjs.
  const KEEP = ['Lester Street', 'Hazel Street', 'Phillip Street', 'Seagram Drive', 'Albert Street', 'Regina Street', 'Caroline Street', 'Erb Street', 'Bridgeport Road', 'Columbia Street', 'Westmount Road', 'University Avenue', 'King Street', 'Weber Street'];
  const net = applyWaterlooZones(convertOverpass(raw, WATERLOO_BBOX, { id: 'waterloo', maxJunctions: 120, keepNames: KEEP }));

  it('produces a sane, simulatable network', () => {
    const s = summary(net);
    expect(s.junctions).toBeGreaterThanOrEqual(80);
    expect(s.junctions).toBeLessThanOrEqual(120);
    expect(s.signals).toBeGreaterThan(20);
    const streets = ['University Avenue', 'King Street', 'Columbia Street', 'Westmount Road', 'Erb Street', 'Weber Street'];
    streets.push('Albert Street', 'Phillip Street', 'Seagram Drive', 'Bridgeport Road', 'Caroline Street', 'Regina Street', 'Lester Street', 'Hazel Street');
    for (const street of streets) {
      expect([...s.names].some((n) => n.startsWith(street))).toBe(true);
    }
    expect(networkProblems(net)).toEqual([]);
    expect(stronglyConnected(net)).toBe(true);
    // junction boxes should not be crammed together
    const short = net.edges.filter((e) => e.length < 8);
    expect(short.length).toBeLessThanOrEqual(net.edges.length * 0.02);
    expect(net.geo).toEqual(WATERLOO_BBOX);
  });

  it('has Campus, Uptown and residential zones with OD for every preset', () => {
    const names = net.zones.map((z) => z.name);
    expect(names).toContain('Campus');
    expect(names).toContain('Uptown');
    expect(names.some((n) => n.startsWith('Residential'))).toBe(true);
    for (const z of net.zones) expect(z.nodes.length).toBeGreaterThan(0);
    for (const p of ['low', 'normal', 'rush', 'event'] as const) expect(Object.keys(net.od?.[p] ?? {}).length).toBe(net.zones.length);
    expect(checkConnectivity(net).ok).toBe(true);
  });

  it('matches the baked src/net/waterloo.json', async () => {
    const baked = await loadWaterloo();
    expect(baked.nodes.length).toBe(net.nodes.length);
    expect(baked.edges.length).toBe(net.edges.length);
    expect(baked.attribution).toContain('OpenStreetMap');
    expect(baked.geo).toEqual(WATERLOO_BBOX);
    expect(networkProblems(baked)).toEqual([]);
  });

  it('bbox size helper', () => {
    const { width, height } = bboxSize(WATERLOO_BBOX);
    expect(width).toBeGreaterThan(2000);
    expect(height).toBeGreaterThan(2000);
  });
});
