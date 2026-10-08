// Waterloo-specific zoning for the baked snapshot: Campus (University of
// Waterloo, north-west), Uptown (around King & Erb) and residential compass zones.

import type { NetNode, RoadNetwork, Zone } from '../sim/types';
import type { BBox } from './osm';
import { projector } from './osm';

/** Uptown Waterloo + University of Waterloo. */
export const WATERLOO_BBOX: BBox = { south: 43.458, west: -80.552, north: 43.479, east: -80.516 };

const UW_CENTRE: [number, number] = [43.4717, -80.5427]; // lat, lon: UW main campus (inside Ring Rd)
const UPTOWN_CENTRE: [number, number] = [43.4651, -80.5227]; // King St & Erb St

const OD_IDS = ['campus', 'uptown', 'res_north', 'res_east', 'res_south', 'res_west'] as const;

export function applyWaterlooZones(net: RoadNetwork, bbox: BBox = WATERLOO_BBOX): RoadNetwork {
  const proj = projector(bbox);
  const uw = proj.toXY(UW_CENTRE[0], UW_CENTRE[1]);
  const up = proj.toXY(UPTOWN_CENTRE[0], UPTOWN_CENTRE[1]);
  const d = (n: NetNode, p: [number, number]) => Math.hypot(n.x - p[0], n.y - p[1]);
  const junctions = net.nodes.filter((n) => n.kind !== 'boundary');
  const boundary = net.nodes.filter((n) => n.kind === 'boundary');

  const nearest = (p: [number, number], pool: NetNode[], radius: number, max: number) =>
    pool
      .filter((n) => d(n, p) <= radius)
      .sort((a, b) => d(a, p) - d(b, p))
      .slice(0, max)
      .map((n) => n.id);

  // Campus: boundary nodes on the north-west side near UW plus the junctions at the campus edge.
  const campusBoundary = boundary.filter((n) => d(n, uw) < 1300 && n.x < uw[0] + 600 && n.y > uw[1] - 500).map((n) => n.id);
  const campus = [...new Set([...nearest(uw, junctions, 700, 5), ...campusBoundary])];
  const uptown = nearest(up, junctions.filter((n) => !campus.includes(n.id)), 350, 5);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of net.nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  const res: Record<'res_north' | 'res_east' | 'res_south' | 'res_west', string[]> = { res_north: [], res_east: [], res_south: [], res_west: [] };
  for (const n of boundary) {
    if (campus.includes(n.id)) continue;
    const dist = { res_north: maxY - n.y, res_south: n.y - minY, res_east: maxX - n.x, res_west: n.x - minX };
    const side = (Object.keys(dist) as (keyof typeof dist)[]).reduce((p, q) => (dist[q] < dist[p] ? q : p));
    res[side].push(n.id);
  }
  const label: Record<keyof typeof res, string> = {
    res_north: 'Residential North',
    res_east: 'Residential East',
    res_south: 'Residential South',
    res_west: 'Residential West',
  };
  const zones: Zone[] = [
    { id: 'campus', name: 'Campus', nodes: campus },
    { id: 'uptown', name: 'Uptown', nodes: uptown },
    ...(Object.keys(res) as (keyof typeof res)[]).map((k) => ({ id: k, name: label[k], nodes: res[k] })),
  ].filter((z) => z.nodes.length > 0);
  const present = new Set(zones.map((z) => z.id));

  const build = (w: (a: string, b: string) => number) => {
    const m: Record<string, Record<string, number>> = {};
    for (const a of OD_IDS) {
      if (!present.has(a)) continue;
      m[a] = {};
      for (const b of OD_IDS) if (a !== b && present.has(b)) m[a][b] = w(a, b);
    }
    return m;
  };
  const isRes = (z: string) => z.startsWith('res_');
  const od: RoadNetwork['od'] = {
    low: build(() => 1),
    normal: build((a, b) => (a === 'uptown' || b === 'uptown' ? 1.4 : 1)),
    rush: build((a, b) => {
      if (isRes(a) && (b === 'campus' || b === 'uptown')) return 6;
      if (isRes(a) && isRes(b)) return 1;
      if (a === 'campus' && b === 'uptown') return 1.5;
      if (a === 'uptown' && b === 'campus') return 2;
      return 0.6;
    }),
    event: build((_a, b) => (b === 'campus' ? 6 : 0.6)),
  };
  return { ...net, id: 'waterloo', name: 'Waterloo — Uptown & UW (OSM)', zones, od };
}
