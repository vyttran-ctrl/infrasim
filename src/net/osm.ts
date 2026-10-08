// OpenStreetMap (Overpass JSON) → RoadNetwork converter.
//
// Pipeline: project to local metres → collapse roundabout rings → clip ways to
// the bbox → split at shared nodes → merge very short links → prune dead ends
// and collapse degree-2 nodes → directed edges → keep the largest strongly
// connected component → junction kinds (signals, roundabouts, crossings) →
// compass zones. If the result has too many junctions, the lowest road class
// is dropped and the conversion is rerun.

import type { NetEdge, NetNode, RoadNetwork, Zone } from '../sim/types';
import { withLengths } from './edits';
import { defaultSignalPlan } from './signals';

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation' | string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OverpassJson {
  elements: OverpassElement[];
}

export interface ConvertOptions {
  id?: string;
  name?: string;
  /** Upper bound on non-boundary nodes; lower road classes are dropped to meet it. */
  maxJunctions?: number;
  /** Edges shorter than this (m) are merged into a single junction. */
  mergeDistance?: number;
  /**
   * Street names (prefix match) that are always kept, whatever their class,
   * e.g. residential collectors that matter locally.
   */
  keepNames?: string[];
}

export const HIGHWAY_PATTERN = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$';
/** Roads, basemap and buildings of every network with `geo` are all OSM data. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

const CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'] as const;
/** Never drop below this rank when trimming junctions (keeps motorway…secondary). */
const MIN_KEEP_RANK = 3;
/**
 * Within the lowest kept class, streets are dropped shortest-first: a named
 * street survives a step if its total length (all its ways of that class) is
 * at least this many metres.
 */
const STREET_LEN_STEPS = [0, 250, 450, 700, 1000, 1500];
const SIGNAL_RADIUS = 25;
const CROSSING_RADIUS = 25;
const EDGE_BAND = 60;
const SLIP_LANE_LENGTH = 150;
/** Nodes of one signalized intersection (dual carriageways) closer than this are merged. */
const SIGNAL_CLUSTER = 40; // m from the bbox edge where dead ends count as boundary
const KMH = 1 / 3.6;

export function overpassQuery(b: BBox): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:25];way["highway"~"${HIGHWAY_PATTERN}"](${box});(._;>;);out body qt;`;
}

// ---------------------------------------------------------------- projection

export interface Projector {
  toXY(lat: number, lon: number): [number, number];
  toLatLon(x: number, y: number): [number, number];
}

const EARTH_R = 6371008.8;

export function projector(b: BBox): Projector {
  const lat0 = (b.south + b.north) / 2;
  const lon0 = (b.west + b.east) / 2;
  const k = Math.PI / 180;
  const cos0 = Math.cos(lat0 * k);
  return {
    toXY: (lat, lon) => [(lon - lon0) * k * EARTH_R * cos0, (lat - lat0) * k * EARTH_R],
    toLatLon: (x, y) => [lat0 + y / (k * EARTH_R), lon0 + x / (k * EARTH_R * cos0)],
  };
}

/** Width and height of a bbox in metres. */
export function bboxSize(b: BBox): { width: number; height: number } {
  const p = projector(b);
  const [x0, y0] = p.toXY(b.south, b.west);
  const [x1, y1] = p.toXY(b.north, b.east);
  return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

// ---------------------------------------------------------------- tag parsing

function classOf(hw: string | undefined): { rank: number; link: boolean } | null {
  if (!hw) return null;
  const m = /^(\w+?)(_link)?$/.exec(hw);
  if (!m) return null;
  const rank = (CLASSES as readonly string[]).indexOf(m[1]);
  return rank < 0 ? null : { rank, link: !!m[2] };
}

function firstInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /\d+/.exec(v);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return n > 0 ? n : undefined;
}

export function parseMaxspeed(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?/i.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!(n > 0)) return undefined;
  const kmh = m[2] && m[2].toLowerCase() === 'mph' ? n * 1.609344 : n;
  return Math.round(kmh * KMH * 10) / 10;
}

const DEFAULT_SPEED_KMH = [100, 80, 60, 50, 50, 40, 40];
const DEFAULT_LANES_TWO_WAY = [2, 2, 2, 1, 1, 1, 1];
const DEFAULT_LANES_ONE_WAY = [2, 2, 2, 2, 1, 1, 1];

interface WayAttrs {
  name: string;
  rank: number;
  roadClass: NonNullable<NetEdge['roadClass']>;
  speed: number;
  oneway: 0 | 1 | -1;
  lanesF: number;
  lanesB: number;
}

function wayAttrs(tags: Record<string, string>): WayAttrs | null {
  const c = classOf(tags.highway);
  if (!c) return null;
  const { rank, link } = c;
  const ow = (tags.oneway ?? '').toLowerCase();
  let oneway: 0 | 1 | -1 = 0;
  if (ow === 'yes' || ow === 'true' || ow === '1') oneway = 1;
  else if (ow === '-1' || ow === 'reverse') oneway = -1;
  else if (ow !== 'no' && (rank === 0 || tags.junction === 'roundabout' || tags.junction === 'circular')) oneway = 1;
  const total = firstInt(tags.lanes);
  const cap = (n: number) => Math.max(1, Math.min(6, n));
  let lanesF: number;
  let lanesB: number;
  if (oneway !== 0) {
    lanesF = lanesB = cap(total ?? (link ? 1 : DEFAULT_LANES_ONE_WAY[rank]));
  } else {
    const half = total ? Math.max(1, Math.floor(total / 2)) : link ? 1 : DEFAULT_LANES_TWO_WAY[rank];
    lanesF = cap(firstInt(tags['lanes:forward']) ?? half);
    lanesB = cap(firstInt(tags['lanes:backward']) ?? half);
  }
  const speed = parseMaxspeed(tags.maxspeed) ?? Math.round((link ? 50 : DEFAULT_SPEED_KMH[rank]) * KMH * 10) / 10;
  const roadClass = rank <= 2 ? 'arterial' : rank <= 4 ? 'collector' : 'local';
  const name = tags.name || tags.ref || (link ? 'Ramp' : 'Unnamed road');
  return { name, rank, roadClass, speed, oneway, lanesF, lanesB };
}

// ---------------------------------------------------------------- geometry helpers

type P = [number, number];

function clipSegment(a: P, b: P, box: { minX: number; maxX: number; minY: number; maxY: number }): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - box.minX, box.maxX - a[0], a[1] - box.minY, box.maxY - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

function polyLen(pts: P[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

function simplify(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (v: number) => Math.round(v * 10) / 10;

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let r = a;
    while (this.parent.has(r) && this.parent.get(r) !== r) r = this.parent.get(r)!;
    // path compression
    let c = a;
    while (c !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string, keep?: string): string {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    const root = keep === undefined ? ra : this.find(keep);
    const other = root === ra ? rb : ra;
    this.parent.set(other, root);
    this.parent.set(root, root);
    return root;
  }
}

// ---------------------------------------------------------------- core

interface Seg extends Omit<WayAttrs, 'oneway'> {
  a: string;
  b: string;
  /** interior points */
  pts: P[];
  /** true = only a → b */
  oneway: boolean;
}

interface Prepared {
  pos: Map<string, P>;
  ways: { id: number; keys: string[]; attrs: WayAttrs; streetLen: number; forced: boolean }[];
  roundabouts: Set<string>;
  /** ring radius per roundabout node, metres */
  ringRadius: Map<string, number>;
  signals: P[];
  crossings: P[];
  box: { minX: number; maxX: number; minY: number; maxY: number };
  bbox: BBox;
}

function prepare(json: OverpassJson, bbox: BBox, keepNames: string[] = []): Prepared {
  const proj = projector(bbox);
  const pos = new Map<string, P>();
  const signals: P[] = [];
  const crossings: P[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
    const p = proj.toXY(el.lat, el.lon);
    pos.set(`n${el.id}`, p);
    const hw = el.tags?.highway;
    if (hw === 'traffic_signals') signals.push(p);
    if (hw === 'crossing' || (el.tags?.crossing && el.tags.crossing !== 'no')) crossings.push(p);
  }
  const rawWays: { id: number; keys: string[]; tags: Record<string, string> }[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.nodes || el.nodes.length < 2 || !el.tags) continue;
    if (!classOf(el.tags.highway) || el.tags.area === 'yes') continue;
    if (el.tags.access === 'private' || el.tags.access === 'no') continue;
    const keys = el.nodes.map((n) => `n${n}`).filter((k) => pos.has(k));
    if (keys.length >= 2) rawWays.push({ id: el.id, keys, tags: el.tags });
  }

  // Roundabouts: union rings that share nodes, collapse each to its centroid.
  const remap = new Map<string, string>();
  const roundabouts = new Set<string>();
  const ringRadius = new Map<string, number>();
  const ringWays = rawWays.filter((w) => w.tags.junction === 'roundabout' || w.tags.junction === 'circular');
  if (ringWays.length) {
    const uf = new UnionFind();
    for (const w of ringWays) for (let i = 1; i < w.keys.length; i++) uf.union(w.keys[0], w.keys[i]);
    const groups = new Map<string, Set<string>>();
    for (const w of ringWays)
      for (const k of w.keys) {
        const r = uf.find(k);
        if (!groups.has(r)) groups.set(r, new Set());
        groups.get(r)!.add(k);
      }
    let ri = 0;
    for (const members of groups.values()) {
      let sx = 0;
      let sy = 0;
      for (const k of members) {
        sx += pos.get(k)![0];
        sy += pos.get(k)![1];
      }
      const c: P = [sx / members.size, sy / members.size];
      let rad = 0;
      for (const k of members) rad = Math.max(rad, Math.hypot(pos.get(k)![0] - c[0], pos.get(k)![1] - c[1]));
      if (rad > 90) continue; // a big traffic circle: keep it as ordinary roads
      const id = `r${++ri}`;
      pos.set(id, c);
      roundabouts.add(id);
      ringRadius.set(id, rad);
      for (const k of members) remap.set(k, id);
    }
  }

  const ways: Prepared['ways'] = [];
  for (const w of rawWays) {
    const isRing = (w.tags.junction === 'roundabout' || w.tags.junction === 'circular') && remap.has(w.keys[0]);
    if (isRing) continue;
    const attrs = wayAttrs(w.tags);
    if (!attrs) continue;
    // Urban slip lanes (short *_link ways below trunk) only clutter the junction.
    if (classOf(w.tags.highway)!.link && attrs.rank >= 2 && polyLen(w.keys.map((k) => pos.get(k)!)) < SLIP_LANE_LENGTH) continue;
    let keys = w.keys.map((k) => remap.get(k) ?? k);
    keys = keys.filter((k, i) => i === 0 || k !== keys[i - 1]);
    if (attrs.oneway === -1) {
      keys.reverse();
      attrs.oneway = 1;
      [attrs.lanesF, attrs.lanesB] = [attrs.lanesB, attrs.lanesF];
    }
    if (keys.length >= 2) ways.push({ id: w.id, keys, attrs, streetLen: 0, forced: keepNames.some((k) => attrs.name.startsWith(k)) });
  }
  // Street importance: total length of all ways sharing a name and class.
  const lenOf = new Map<string, number>();
  const keyOf = (w: Prepared['ways'][number]) => (w.attrs.name === 'Unnamed road' || w.attrs.name === 'Ramp' ? `#${w.id}` : `${w.attrs.rank}|${w.attrs.name}`);
  for (const w of ways) {
    const k = keyOf(w);
    lenOf.set(k, (lenOf.get(k) ?? 0) + polyLen(w.keys.map((x) => pos.get(x)!)));
  }
  for (const w of ways) w.streetLen = lenOf.get(keyOf(w))!;

  const [minX, minY] = proj.toXY(bbox.south, bbox.west);
  const [maxX, maxY] = proj.toXY(bbox.north, bbox.east);
  return { pos, ways, roundabouts, ringRadius, signals, crossings, box: { minX, maxX, minY, maxY }, bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east } };
}

function buildSegments(prep: Prepared, maxRank: number, minLen: number): { segs: Seg[]; pos: Map<string, P>; clip: Set<string> } {
  const pos = new Map(prep.pos);
  const clip = new Set<string>();
  const { box } = prep;
  // 1. clip to bbox
  const pieces: { keys: string[]; attrs: WayAttrs }[] = [];
  let ci = 0;
  for (const w of prep.ways) {
    if (!w.forced && (w.attrs.rank > maxRank || (w.attrs.rank === maxRank && w.streetLen < minLen))) continue;
    let cur: string[] | null = null;
    const addClip = (a: P, b: P, t: number) => {
      const id = `c${w.id}_${++ci}`;
      pos.set(id, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      clip.add(id);
      return id;
    };
    for (let i = 0; i + 1 < w.keys.length; i++) {
      const a = pos.get(w.keys[i])!;
      const b = pos.get(w.keys[i + 1])!;
      const t = clipSegment(a, b, box);
      if (!t) {
        if (cur && cur.length >= 2) pieces.push({ keys: cur, attrs: w.attrs });
        cur = null;
        continue;
      }
      if (!cur) cur = [t[0] > 1e-9 ? addClip(a, b, t[0]) : w.keys[i]];
      cur.push(t[1] < 1 - 1e-9 ? addClip(a, b, t[1]) : w.keys[i + 1]);
      if (t[1] < 1 - 1e-9) {
        pieces.push({ keys: cur, attrs: w.attrs });
        cur = null;
      }
    }
    if (cur && cur.length >= 2) pieces.push({ keys: cur, attrs: w.attrs });
  }
  // 2. junctions: endpoints and nodes used more than once
  const use = new Map<string, number>();
  for (const p of pieces) for (const k of p.keys) use.set(k, (use.get(k) ?? 0) + 1);
  const isJ = (k: string, i: number, n: number) => i === 0 || i === n - 1 || (use.get(k) ?? 0) >= 2 || prep.roundabouts.has(k);
  const segs: Seg[] = [];
  for (const p of pieces) {
    let start = 0;
    for (let i = 1; i < p.keys.length; i++) {
      if (!isJ(p.keys[i], i, p.keys.length)) continue;
      const a = p.keys[start];
      const b = p.keys[i];
      if (a !== b) {
        const { oneway, ...rest } = p.attrs;
        segs.push({ ...rest, a, b, oneway: oneway !== 0, pts: p.keys.slice(start + 1, i).map((k) => pos.get(k)!) });
      }
      start = i;
    }
  }
  return { segs, pos, clip };
}

function segLen(s: Seg, pos: Map<string, P>): number {
  return polyLen([pos.get(s.a)!, ...s.pts, pos.get(s.b)!]);
}

function reverseSeg(s: Seg): Seg {
  return { ...s, a: s.b, b: s.a, pts: s.pts.slice().reverse(), lanesF: s.lanesB, lanesB: s.lanesF };
}

function distToEdge(p: P, box: Prepared['box']): number {
  return Math.min(p[0] - box.minX, box.maxX - p[0], p[1] - box.minY, box.maxY - p[1]);
}

/** Kosaraju: largest strongly connected component of the directed graph. */
function largestScc(nodes: string[], arcs: [string, string][]): Set<string> {
  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const n of nodes) {
    fwd.set(n, []);
    bwd.set(n, []);
  }
  for (const [a, b] of arcs) {
    fwd.get(a)?.push(b);
    bwd.get(b)?.push(a);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of nodes) {
    if (seen.has(s)) continue;
    seen.add(s);
    const stack: [string, number][] = [[s, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const out = fwd.get(top[0])!;
      if (top[1] < out.length) {
        const m = out[top[1]++];
        if (!seen.has(m)) {
          seen.add(m);
          stack.push([m, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Map<string, number>();
  let best = -1;
  let bestSize = 0;
  let c = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i];
    if (comp.has(s)) continue;
    let size = 0;
    const stack = [s];
    comp.set(s, c);
    while (stack.length) {
      const n = stack.pop()!;
      size++;
      for (const m of bwd.get(n)!) {
        if (!comp.has(m)) {
          comp.set(m, c);
          stack.push(m);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  return new Set(nodes.filter((n) => comp.get(n) === best));
}

interface Graph {
  segs: Seg[];
  pos: Map<string, P>;
  boundary: Set<string>;
}

function simplifyGraph(prep: Prepared, maxRank: number, minLen: number, mergeDistance: number): Graph {
  const built = buildSegments(prep, maxRank, minLen);
  const { pos, clip } = built;
  let segs = built.segs;

  // 3. merge very short links into one junction (clip/boundary nodes are kept as they are);
  //    the several nodes of one signalized dual-carriageway crossing become one junction
  const nearSignal = (p: P) => prep.signals.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= SIGNAL_RADIUS);
  const uf = new UnionFind();
  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (const s of segs) {
      const a = uf.find(s.a);
      const b = uf.find(s.b);
      if (a === b || clip.has(a) || clip.has(b)) continue;
      const len = polyLen([pos.get(a)!, ...s.pts, pos.get(b)!]);
      const limit =
        nearSignal(pos.get(a)!) && nearSignal(pos.get(b)!) ? Math.max(mergeDistance, SIGNAL_CLUSTER) : mergeDistance;
      if (len >= limit) continue;
      const keep = prep.roundabouts.has(b) && !prep.roundabouts.has(a) ? b : a;
      const other = keep === a ? b : a;
      const pk = pos.get(keep)!;
      const po = pos.get(other)!;
      const np: P = prep.roundabouts.has(keep) ? pk : [(pk[0] + po[0]) / 2, (pk[1] + po[1]) / 2];
      const root = uf.union(keep, other, keep);
      pos.set(root, np);
      merged = true;
    }
    segs = segs
      .map((s) => ({ ...s, a: uf.find(s.a), b: uf.find(s.b) }))
      .filter((s) => s.a !== s.b);
    if (!merged) break;
  }
  // Points that ended up inside the merged junction disc are dropped.
  segs = segs.map((s) => {
    const pa = pos.get(s.a)!;
    const pb = pos.get(s.b)!;
    const pts = s.pts.filter((p) => Math.hypot(p[0] - pa[0], p[1] - pa[1]) > 3 && Math.hypot(p[0] - pb[0], p[1] - pb[1]) > 3);
    return pts.length === s.pts.length ? s : { ...s, pts };
  });

  const boundary = new Set<string>();
  for (let round = 0; round < 8; round++) {
    let changed = false;
    // 4. prune interior dead ends; dead ends near the bbox edge become boundary nodes
    for (;;) {
      const deg = new Map<string, number>();
      for (const s of segs) {
        deg.set(s.a, (deg.get(s.a) ?? 0) + 1);
        deg.set(s.b, (deg.get(s.b) ?? 0) + 1);
      }
      const drop = new Set<string>();
      for (const [n, d] of deg) {
        if (d !== 1) continue;
        if (clip.has(n) || distToEdge(pos.get(n)!, prep.box) < EDGE_BAND) boundary.add(n);
        else drop.add(n);
      }
      if (!drop.size) break;
      segs = segs.filter((s) => !drop.has(s.a) && !drop.has(s.b));
      changed = true;
    }
    // 5. collapse degree-2 pass-through nodes
    for (;;) {
      const inc = new Map<string, number[]>();
      segs.forEach((s, i) => {
        for (const n of [s.a, s.b]) {
          if (!inc.has(n)) inc.set(n, []);
          inc.get(n)!.push(i);
        }
      });
      let did = false;
      const dead = new Set<number>();
      const added: Seg[] = [];
      for (const [n, list] of inc) {
        if (list.length !== 2 || boundary.has(n) || prep.roundabouts.has(n)) continue;
        if (list.some((i) => dead.has(i))) continue;
        let s1 = segs[list[0]];
        let s2 = segs[list[1]];
        if (s1.oneway !== s2.oneway) continue;
        if (s1.oneway) {
          if (s1.a === n && s2.b === n) [s1, s2] = [s2, s1];
          if (!(s1.b === n && s2.a === n)) continue;
        } else {
          if (s1.b !== n) s1 = reverseSeg(s1);
          if (s2.a !== n) s2 = reverseSeg(s2);
        }
        if (s1.a === s2.b) continue; // would become a loop
        const main = segLen(s1, pos) >= segLen(s2, pos) ? s1 : s2;
        added.push({
          ...main,
          a: s1.a,
          b: s2.b,
          pts: [...s1.pts, pos.get(n)!, ...s2.pts],
          lanesF: main.lanesF,
          lanesB: main.lanesB,
        });
        dead.add(list[0]);
        dead.add(list[1]);
        did = true;
      }
      if (!did) break;
      segs = [...segs.filter((_, i) => !dead.has(i)), ...added];
      changed = true;
    }
    // 6. largest strongly connected component
    const nodeSet = new Set<string>();
    const arcs: [string, string][] = [];
    for (const s of segs) {
      nodeSet.add(s.a);
      nodeSet.add(s.b);
      arcs.push([s.a, s.b]);
      if (!s.oneway) arcs.push([s.b, s.a]);
    }
    const scc = largestScc([...nodeSet], arcs);
    const before = segs.length;
    segs = segs.filter((s) => scc.has(s.a) && scc.has(s.b));
    if (segs.length !== before) changed = true;
    if (!changed) break;
  }
  const live = new Set<string>();
  for (const s of segs) {
    live.add(s.a);
    live.add(s.b);
  }
  for (const b of [...boundary]) if (!live.has(b)) boundary.delete(b);
  return { segs, pos, boundary };
}

function compassZones(nodes: NetNode[], box: Prepared['box']): Zone[] {
  const sides: Record<'north' | 'east' | 'south' | 'west', string[]> = { north: [], east: [], south: [], west: [] };
  for (const n of nodes) {
    if (n.kind !== 'boundary') continue;
    const d = { north: box.maxY - n.y, south: n.y - box.minY, east: box.maxX - n.x, west: n.x - box.minX };
    const side = (Object.keys(d) as (keyof typeof d)[]).reduce((p, q) => (d[q] < d[p] ? q : p));
    sides[side].push(n.id);
  }
  return (Object.keys(sides) as (keyof typeof sides)[])
    .filter((k) => sides[k].length > 0)
    .map((k) => ({ id: k, name: k[0].toUpperCase() + k.slice(1), nodes: sides[k] }));
}

export function uniformOd(zones: Zone[]): NonNullable<RoadNetwork['od']> {
  const m: Record<string, Record<string, number>> = {};
  for (const a of zones) {
    m[a.id] = {};
    for (const b of zones) if (a.id !== b.id) m[a.id][b.id] = 1;
  }
  return { low: m, normal: m, rush: m, event: m };
}

function toNetwork(g: Graph, prep: Prepared, opts: ConvertOptions): RoadNetwork {
  const deg = new Map<string, number>();
  for (const s of g.segs) {
    deg.set(s.a, (deg.get(s.a) ?? 0) + 1);
    deg.set(s.b, (deg.get(s.b) ?? 0) + 1);
  }
  const ids = [...deg.keys()];
  const near = (p: P, list: P[], r: number) => list.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= r);
  const nodes: NetNode[] = ids.map((id) => {
    const p = g.pos.get(id)!;
    let kind: NetNode['kind'] = 'priority';
    if (g.boundary.has(id)) kind = 'boundary';
    else if (prep.roundabouts.has(id)) kind = 'roundabout';
    else if ((deg.get(id) ?? 0) >= 3 && near(p, prep.signals, SIGNAL_RADIUS)) kind = 'signal';
    const node: NetNode = { id, x: r1(p[0]), y: r1(p[1]), kind };
    // Crosswalks: zebra at unsignalized junctions (signals already include walk time in their phases).
    if ((kind === 'priority' || kind === 'roundabout') && near(p, prep.crossings, CROSSING_RADIUS + (prep.ringRadius.get(id) ?? 0))) node.pedCrossing = true;
    return node;
  });

  const edges: NetEdge[] = [];
  const seenDir = new Map<string, number>();
  let ei = 0;
  const push = (e: NetEdge) => {
    const k = `${e.from}>${e.to}`;
    const prev = seenDir.get(k);
    if (prev !== undefined) {
      if (edges[prev].lanes >= e.lanes) return false;
      edges[prev] = { ...e, id: edges[prev].id, pairId: edges[prev].pairId };
      return false;
    }
    seenDir.set(k, edges.length);
    edges.push(e);
    return true;
  };
  // Higher classes first so they win duplicate (from, to) pairs.
  const ordered = g.segs.slice().sort((p, q) => p.rank - q.rank);
  for (const s of ordered) {
    const pa = g.pos.get(s.a)!;
    const pb = g.pos.get(s.b)!;
    const full = simplify([pa, ...s.pts, pb], 1.0);
    const pts = full.slice(1, -1).map((p): P => [r1(p[0]), r1(p[1])]);
    const id = `e${++ei}`;
    const base = { name: s.name, speedLimit: s.speed, length: 0, closed: false, busLanes: 0, bikeLane: false, roadClass: s.roadClass };
    const f: NetEdge = { id, from: s.a, to: s.b, lanes: s.lanesF, ...base, ...(pts.length ? { points: pts } : {}) };
    if (s.oneway) {
      push(f);
    } else {
      const rid = `${id}r`;
      const b: NetEdge = { id: rid, from: s.b, to: s.a, lanes: s.lanesB, ...base, pairId: id, ...(pts.length ? { points: pts.slice().reverse() } : {}) };
      f.pairId = rid;
      push(f);
      push(b);
    }
  }
  const edgeIds = new Set(edges.map((e) => e.id));
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.pairId && !edgeIds.has(e.pairId)) {
      const { pairId: _p, ...rest } = e;
      void _p;
      edges[i] = rest;
    } else if (e.pairId) {
      const other = edges.find((x) => x.id === e.pairId)!;
      if (other.pairId !== e.id) {
        const { pairId: _p, ...rest } = e;
        void _p;
        edges[i] = rest;
      }
    }
  }

  const zones = compassZones(nodes, prep.box);
  let net: RoadNetwork = {
    id: opts.id ?? 'osm',
    name: opts.name ?? 'OpenStreetMap import',
    nodes,
    edges,
    signals: [],
    zones,
    od: uniformOd(zones),
    geo: { ...prep.bbox },
    attribution: OSM_ATTRIBUTION,
  };
  net = withLengths(net);
  net = { ...net, signals: nodes.filter((n) => n.kind === 'signal').map((n) => defaultSignalPlan(net, n.id)) };
  return net;
}

export function junctionCount(net: RoadNetwork): number {
  return net.nodes.filter((n) => n.kind !== 'boundary').length;
}

/** Convert an Overpass `out body` JSON (ways + their nodes) to a RoadNetwork. */
export function convertOverpass(json: OverpassJson, bbox: BBox, opts: ConvertOptions = {}): RoadNetwork {
  const maxJ = opts.maxJunctions ?? 80;
  const merge = opts.mergeDistance ?? 12;
  const prep = prepare(json, bbox, opts.keepNames);
  const present = new Set(prep.ways.map((w) => w.attrs.rank));
  const top = Math.max(-1, ...present);
  // Candidate levels, richest first: (lowest kept class, min street length in that class).
  const levels: [number, number][] = [];
  for (let r = top; r >= Math.min(top, MIN_KEEP_RANK); r--) {
    if (!present.has(r) && r !== top) continue;
    for (const L of r > MIN_KEEP_RANK ? STREET_LEN_STEPS : [0]) levels.push([r, L]);
  }
  let net: RoadNetwork | null = null;
  for (const [r, L] of levels) {
    const next = toNetwork(simplifyGraph(prep, r, L, merge), prep, opts);
    if (net && next.edges.length === 0) break;
    net = next;
    if (junctionCount(net) <= maxJ) break;
  }
  return net!;
}
