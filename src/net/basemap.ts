// Plan-sheet basemap from OpenStreetMap: parks, water, campus grounds,
// parking, every street and path, rail and streams, plus names for the big
// areas. Projected with the network's own projector, so it lines up with the
// simulated roads by construction. Render-only (never part of RoadNetwork).

import type { BBox } from './osm';
import { projector } from './osm';

export type AreaKind = 'campus' | 'green' | 'wood' | 'pitch' | 'parking' | 'plaza' | 'rail' | 'water';
export type LineKind = 'major' | 'street' | 'service' | 'path' | 'rail' | 'stream';
export type MapLabelKind = 'campus' | 'park' | 'water';

const AREA_KINDS: AreaKind[] = ['campus', 'green', 'wood', 'pitch', 'parking', 'plaza', 'rail', 'water'];
const LINE_KINDS: LineKind[] = ['major', 'street', 'service', 'path', 'rail', 'stream'];
const LABEL_KINDS: MapLabelKind[] = ['campus', 'park', 'water'];

type P = [number, number];

export interface MapArea { kind: AreaKind; /** CCW outer ring then holes */ rings: P[][] }
export interface MapLine { kind: LineKind; pts: P[] }
export interface MapLabel { text: string; kind: MapLabelKind; x: number; y: number; size: number }

export interface BasemapData {
  areas: MapArea[];
  lines: MapLine[];
  labels: MapLabel[];
}

export interface PackedBasemap {
  v: 1;
  /** [kind, ringCount, n0, x, y, ... (n0 pairs), n1, ...] — decimetres */
  a: number[][];
  /** [kind, x0, y0, x1, y1, ...] — decimetres */
  l: number[][];
  /** [text, kind, x, y, size] — metres */
  t: [string, number, number, number, number][];
}

export const EMPTY_BASEMAP: BasemapData = { areas: [], lines: [], labels: [] };

// ---------------------------------------------------------------- Overpass

/** Overpass clauses (no header/output) for the basemap features inside `box`. */
export function basemapClauses(box: string): string {
  return [
    `way["highway"](${box});`,
    `way["railway"~"^(rail|light_rail|tram)$"](${box});`,
    `way["waterway"~"^(river|stream|canal)$"](${box});`,
    `nwr["leisure"~"^(park|garden|pitch|golf_course|nature_reserve|recreation_ground|track|stadium)$"](${box});`,
    `nwr["landuse"~"^(grass|recreation_ground|meadow|forest|cemetery|village_green|reservoir|basin|railway)$"](${box});`,
    `nwr["natural"~"^(water|wood|scrub|grassland|wetland)$"](${box});`,
    `nwr["amenity"~"^(university|college|school|parking)$"](${box});`,
  ].join('');
}

export function basemapQuery(b: BBox): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:90];(${basemapClauses(box)});out geom qt;`;
}

interface GeomPoint { lat: number; lon: number }
export interface GeomElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: GeomPoint[];
  members?: { type: string; role?: string; geometry?: GeomPoint[] }[];
}

function areaKind(t: Record<string, string>): AreaKind | null {
  const am = t.amenity, le = t.leisure, lu = t.landuse, na = t.natural;
  if (na === 'water' || lu === 'reservoir' || lu === 'basin') return 'water';
  if (am === 'parking') return t.parking === 'underground' || t.parking === 'multi-storey' ? null : 'parking';
  if (le === 'pitch' || le === 'track' || le === 'stadium') return 'pitch';
  if (lu === 'forest' || na === 'wood' || na === 'scrub' || na === 'wetland') return 'wood';
  if (le || lu === 'grass' || lu === 'recreation_ground' || lu === 'meadow' || lu === 'cemetery' || lu === 'village_green' || na === 'grassland') return 'green';
  if (am === 'university' || am === 'college' || am === 'school') return 'campus';
  if (lu === 'railway') return 'rail';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'plaza';
  return null;
}

function lineKind(t: Record<string, string>): LineKind | null {
  if (t.railway === 'rail' || t.railway === 'light_rail' || t.railway === 'tram') return 'rail';
  if (t.waterway === 'river' || t.waterway === 'stream' || t.waterway === 'canal') return t.tunnel === 'culvert' ? null : 'stream';
  const hw = t.highway;
  if (!hw || t.area === 'yes') return null;
  if (t.indoor === 'yes' || t.level?.startsWith('-')) return null;
  if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(hw)) return 'major';
  if (hw === 'residential' || hw === 'unclassified' || hw === 'living_street') return 'street';
  if (hw === 'service') return t.service === 'parking_aisle' || t.service === 'drive-through' ? null : 'service';
  if (hw === 'footway') return t.footway === 'sidewalk' || t.footway === 'crossing' ? null : 'path';
  if (hw === 'path' || hw === 'cycleway' || hw === 'pedestrian' || hw === 'track') return 'path';
  return null;
}

function same(p: GeomPoint, q: GeomPoint) {
  return Math.abs(p.lat - q.lat) < 1e-7 && Math.abs(p.lon - q.lon) < 1e-7;
}

/** Join way fragments end to end into closed rings. */
export function stitchRings(parts: GeomPoint[][]): GeomPoint[][] {
  const open = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings: GeomPoint[][] = [];
  while (open.length) {
    let cur = open.shift()!;
    let grew = true;
    while (!same(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        const end = cur[cur.length - 1];
        if (same(end, o[0])) cur = [...cur, ...o.slice(1)];
        else if (same(end, o[o.length - 1])) cur = [...cur, ...o.slice(0, -1).reverse()];
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}

/** Douglas–Peucker over an open polyline (endpoints kept). */
export function simplifyLine(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const L = Math.hypot(bx - ax, by - ay);
    let best = -1;
    let bd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = L < 1e-9 ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay) : Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (no repeated closing vertex). */
export function simplifyRing(ring: P[], tol: number): P[] {
  if (ring.length <= 4) return ring;
  let far = 1;
  let fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export function signedArea(pts: P[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

function inRing(ring: P[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(ring: P[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/** A point well inside the polygon (coarse pole of inaccessibility), within `clip`. */
function labelPoint(rings: P[][], clip: { minX: number; minY: number; maxX: number; maxY: number }): P | null {
  const outer = rings[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  minX = Math.max(minX, clip.minX); maxX = Math.min(maxX, clip.maxX);
  minY = Math.max(minY, clip.minY); maxY = Math.min(maxY, clip.maxY);
  if (minX >= maxX || minY >= maxY) return null;
  let best: P | null = null;
  let bd = 0;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (!inRing(outer, x, y) || rings.slice(1).some((h) => inRing(h, x, y))) continue;
      const d = Math.min(...rings.map((r) => distToRing(r, x, y)), x - clip.minX, clip.maxX - x, y - clip.minY, clip.maxY - y);
      if (d > bd) { bd = d; best = [x, y]; }
    }
  }
  return best;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Overpass `out geom` JSON → basemap layers in local metres around `bbox`'s centre. */
export function convertBasemap(json: { elements?: GeomElement[] }, bbox: BBox, margin = 450): BasemapData {
  const proj = projector(bbox);
  const [bx0, by0] = proj.toXY(bbox.south, bbox.west);
  const [bx1, by1] = proj.toXY(bbox.north, bbox.east);
  const box = { minX: bx0 - margin, minY: by0 - margin, maxX: bx1 + margin, maxY: by1 + margin };
  const inBox = (p: P) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY;
  const toP = (g: GeomPoint[]): P[] => g.map((q) => proj.toXY(q.lat, q.lon));
  const clean = (ring: P[]): P[] | null => {
    let r = ring;
    if (r.length >= 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.05) r = r.slice(0, -1);
    if (r.length < 3) return null;
    r = simplifyRing(r, 1.0).map((p): P => [r1(p[0]), r1(p[1])]);
    return r.length >= 3 && Math.abs(signedArea(r)) > 20 ? r : null;
  };

  const areas: MapArea[] = [];
  const lines: MapLine[] = [];
  const labels: MapLabel[] = [];
  const named = new Set<string>();
  for (const el of json.elements ?? []) {
    const t = el.tags;
    if (!t) continue;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const lk = lineKind(t);
      const g = el.geometry;
      const closed = same(g[0], g[g.length - 1]);
      const ak = areaKind(t);
      if (ak && closed) {
        const ring = clean(toP(g));
        if (ring && ring.some(inBox)) pushArea(ak, [ring], t);
        continue;
      }
      if (lk) {
        const pts = simplifyLine(toP(g), 0.8).map((p): P => [r1(p[0]), r1(p[1])]);
        if (pts.length >= 2 && pts.some(inBox)) lines.push({ kind: lk, pts });
      }
    } else if (el.type === 'relation' && el.members) {
      const ak = areaKind(t);
      if (!ak) continue;
      const outers = stitchRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry!));
      const inners = stitchRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry!))
        .map((g) => clean(toP(g)))
        .filter((r): r is P[] => !!r);
      let labelled = false;
      for (const og of outers) {
        const outer = clean(toP(og));
        if (!outer || !outer.some(inBox)) continue;
        const holes = inners.filter((h) => inRing(outer, h[0][0], h[0][1]));
        pushArea(ak, [outer, ...holes], labelled ? {} : t);
        labelled = true;
      }
    }
  }

  function pushArea(kind: AreaKind, rings: P[][], t: Record<string, string>) {
    const [outer, ...holes] = rings;
    if (signedArea(outer) < 0) outer.reverse();
    for (const h of holes) if (signedArea(h) > 0) h.reverse();
    areas.push({ kind, rings: [outer, ...holes] });
    const name = t.name;
    if (!name || named.has(name) || /stormwater|retention|catchment|reserve$/i.test(name)) return;
    const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    const lk: MapLabelKind | null = kind === 'campus' ? (area > 30000 && t.amenity !== 'school' ? 'campus' : null) : kind === 'water' ? (area > 4000 ? 'water' : null) : kind === 'green' || kind === 'wood' ? (area > 9000 ? 'park' : null) : null;
    if (!lk) return;
    const p = labelPoint([outer, ...holes], { minX: bx0, minY: by0, maxX: bx1, maxY: by1 });
    if (!p) return;
    named.add(name);
    const size = lk === 'campus' ? Math.min(30, Math.max(14, Math.sqrt(area) / 28)) : Math.min(13, Math.max(6, Math.sqrt(area) / 22));
    labels.push({ text: name, kind: lk, x: r1(p[0]), y: r1(p[1]), size: r1(size) });
  }

  // paint order: low-priority grounds first
  areas.sort((a, b) => AREA_KINDS.indexOf(a.kind) - AREA_KINDS.indexOf(b.kind));
  lines.sort((a, b) => LINE_KINDS.indexOf(a.kind) - LINE_KINDS.indexOf(b.kind));
  return { areas, lines, labels };
}

// ---------------------------------------------------------------- packing

const dm = (v: number) => Math.round(v * 10);

export function packBasemap(d: BasemapData): PackedBasemap {
  return {
    v: 1,
    a: d.areas.map((a) => {
      const row = [AREA_KINDS.indexOf(a.kind), a.rings.length];
      for (const r of a.rings) {
        row.push(r.length);
        for (const p of r) row.push(dm(p[0]), dm(p[1]));
      }
      return row;
    }),
    l: d.lines.map((l) => {
      const row = [LINE_KINDS.indexOf(l.kind)];
      for (const p of l.pts) row.push(dm(p[0]), dm(p[1]));
      return row;
    }),
    t: d.labels.map((t) => [t.text, LABEL_KINDS.indexOf(t.kind), t.x, t.y, t.size]),
  };
}

export function unpackBasemap(p: PackedBasemap): BasemapData {
  const areas: MapArea[] = p.a.map((row) => {
    const rings: P[][] = [];
    let i = 2;
    for (let k = 0; k < row[1]; k++) {
      const n = row[i++];
      const r: P[] = [];
      for (let j = 0; j < n; j++, i += 2) r.push([row[i] / 10, row[i + 1] / 10]);
      rings.push(r);
    }
    return { kind: AREA_KINDS[row[0]] ?? 'green', rings };
  });
  const lines: MapLine[] = p.l.map((row) => {
    const pts: P[] = [];
    for (let i = 1; i + 1 < row.length; i += 2) pts.push([row[i] / 10, row[i + 1] / 10]);
    return { kind: LINE_KINDS[row[0]] ?? 'path', pts };
  });
  const labels: MapLabel[] = p.t.map(([text, k, x, y, size]) => ({ text, kind: LABEL_KINDS[k] ?? 'park', x, y, size }));
  return { areas, lines, labels };
}
