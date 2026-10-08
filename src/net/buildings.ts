// OSM building footprints for networks built from real map data.
//
// Footprints are render-only: they never enter RoadNetwork (which goes to the
// worker and into saved scenarios). The renderer asks for them by network via
// getMapContext() / getBuildings() (mapContext.ts); Waterloo's are baked
// (scripts/bake-waterloo.mjs) into a lazily-loaded JSON chunk.

import { signedArea, simplifyRing, stitchRings as stitch, type GeomElement } from './basemap';
import type { BBox } from './osm';
import { projector } from './osm';

export type BuildingKind = 'house' | 'apartments' | 'commercial' | 'civic' | 'minor' | 'other';
const KINDS: BuildingKind[] = ['house', 'apartments', 'commercial', 'civic', 'minor', 'other'];

export interface BuildingFootprint {
  /** CCW outline in local metres (no repeated closing vertex). */
  pts: [number, number][];
  /** metres */
  h: number;
  kind: BuildingKind;
}

/** Compact on-disk form: coordinates in decimetres, one flat row per building. */
export interface PackedBuildings {
  v: 1;
  /** [height m, kind index, x0, y0, x1, y1, ...] with x/y in decimetres */
  b: number[][];
}

// ---------------------------------------------------------------- Overpass → footprints

/** Overpass clauses (no header/output) for building footprints inside `box`. */
export function buildingClauses(box: string): string {
  return `way["building"](${box});relation["building"](${box});`;
}

export function buildingsQuery(b: BBox): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:60];(${buildingClauses(box)});out geom qt;`;
}

const SKIP = new Set(['no', 'bridge', 'construction', 'proposed', 'demolished', 'ruins', 'collapsed']);

function kindOf(b: string): BuildingKind {
  switch (b) {
    case 'house': case 'detached': case 'semidetached_house': case 'terrace': case 'residential': case 'bungalow': case 'duplex':
      return 'house';
    case 'apartments': case 'dormitory': case 'hotel':
      return 'apartments';
    case 'retail': case 'commercial': case 'office': case 'supermarket': case 'industrial': case 'warehouse': case 'kiosk':
      return 'commercial';
    case 'university': case 'college': case 'school': case 'public': case 'civic': case 'government': case 'church': case 'chapel':
    case 'mosque': case 'synagogue': case 'temple': case 'cathedral': case 'hospital': case 'train_station': case 'transportation':
    case 'sports_centre': case 'sports_hall': case 'stadium': case 'grandstand': case 'library': case 'museum':
      return 'civic';
    case 'garage': case 'garages': case 'shed': case 'roof': case 'carport': case 'service': case 'toilets': case 'greenhouse':
    case 'barn': case 'hut': case 'cabin':
      return 'minor';
    default:
      return 'other';
  }
}

const DEFAULT_H: Record<string, number> = {
  house: 7, detached: 7, semidetached_house: 7, terrace: 8, residential: 8, bungalow: 5,
  apartments: 13, dormitory: 15, hotel: 18,
  retail: 5.5, commercial: 10, office: 12, supermarket: 6, industrial: 8, warehouse: 8,
  university: 14, college: 13, school: 9, public: 10, civic: 10, government: 10,
  church: 12, chapel: 9, mosque: 10, train_station: 6, parking: 9, stadium: 12, grandstand: 9,
  sports_centre: 11, sports_hall: 10,
  garage: 3, garages: 3, shed: 2.6, roof: 4.5, carport: 3, service: 3.5, toilets: 3, greenhouse: 3.5, barn: 6,
};

function parseMetres(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /(\d+(?:\.\d+)?)\s*(ft|')?/.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]) * (m[2] ? 0.3048 : 1);
  return n > 0 && n < 400 ? n : undefined;
}

export interface HeightHints {
  /** Called with the footprint centroid (local metres); returns a default height for untyped `building=yes`. */
  untypedDefault?: (x: number, y: number) => number;
}

function heightOf(tags: Record<string, string>, cx: number, cy: number, hints: HeightHints): number {
  const h = parseMetres(tags.height) ?? parseMetres(tags['building:height']);
  if (h) return h;
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (levels > 0 && levels < 120) {
    const roof = parseFloat(tags['roof:levels'] ?? '');
    return levels * 3.2 + (roof > 0 ? roof * 1.6 : 0) + 0.6;
  }
  const b = tags.building;
  if (DEFAULT_H[b] !== undefined) return DEFAULT_H[b];
  return hints.untypedDefault?.(cx, cy) ?? 7;
}

type P = [number, number];

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Overpass `out geom` JSON (ways + multipolygon relations tagged building) → footprints in local metres. */
export function convertBuildings(json: { elements?: GeomElement[] }, bbox: BBox, hints: HeightHints = {}): BuildingFootprint[] {
  const proj = projector(bbox);
  const out: BuildingFootprint[] = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags;
    if (!tags || !tags.building || SKIP.has(tags.building)) continue;
    if (tags.location === 'underground' || parseFloat(tags.layer ?? '0') < 0) continue;
    let rings: NonNullable<GeomElement['geometry']>[] = [];
    if (el.type === 'way' && el.geometry) rings = [el.geometry];
    else if (el.type === 'relation' && el.members) {
      rings = stitch(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry!));
    }
    for (const g of rings) {
      let ring: P[] = g.map((p) => proj.toXY(p.lat, p.lon));
      const n = ring.length;
      if (n >= 2 && Math.hypot(ring[0][0] - ring[n - 1][0], ring[0][1] - ring[n - 1][1]) < 0.05) ring = ring.slice(0, -1);
      if (ring.length < 3) continue;
      ring = simplifyRing(ring, 0.5).map((p): P => [r1(p[0]), r1(p[1])]);
      ring = ring.filter((p, i) => {
        const q = ring[(i + ring.length - 1) % ring.length];
        return i === 0 || p[0] !== q[0] || p[1] !== q[1];
      });
      if (ring.length < 3) continue;
      const area = signedArea(ring);
      if (Math.abs(area) < 6) continue;
      if (area < 0) ring.reverse();
      let cx = 0, cy = 0;
      for (const p of ring) { cx += p[0]; cy += p[1]; }
      cx /= ring.length; cy /= ring.length;
      const h = Math.round(Math.max(2.5, heightOf(tags, cx, cy, hints)) * 10) / 10;
      out.push({ pts: ring, h, kind: kindOf(tags.building) });
    }
  }
  return out;
}

export function packBuildings(list: BuildingFootprint[]): PackedBuildings {
  return {
    v: 1,
    b: list.map((f) => {
      const row = [f.h, KINDS.indexOf(f.kind)];
      for (const p of f.pts) row.push(Math.round(p[0] * 10), Math.round(p[1] * 10));
      return row;
    }),
  };
}

export function unpackBuildings(data: PackedBuildings): BuildingFootprint[] {
  return data.b.map((row) => {
    const pts: [number, number][] = [];
    for (let i = 2; i + 1 < row.length; i += 2) pts.push([row[i] / 10, row[i + 1] / 10]);
    return { h: row[0], kind: KINDS[row[1]] ?? 'other', pts };
  });
}

export async function loadWaterlooBuildings(): Promise<BuildingFootprint[]> {
  const mod = await import('./waterlooBuildings.json');
  return unpackBuildings((mod.default ?? mod) as unknown as PackedBuildings);
}
