// Real (OSM) building footprints → one merged, lit prism geometry. Pure.
// Footprints that would sit on a simulated road (beyond a small tolerance)
// are dropped so buildings never hide the ribbons.

import * as THREE from 'three';
import { palette } from '../app/palette';
import type { BuildingFootprint } from '../net/buildings';
import { mixRGB, rgb, type RGB } from './buffers';
import type { RoadBuild } from './build';
import { distToPolygonEdge, hash01, pointInPolygon, type P2 } from './polyline';

/** Base of the prisms: just above the flat road layers' heights so the AO line reads. */
const BASE = 0;
/** Allowed intrusion of a footprint into a road's paved half-width, metres. */
const TOLERANCE = 1.2;
const SAMPLE = 2;
const CELL = 24;

interface Sample { x: number; y: number; r: number }

function roadSamples(build: RoadBuild): { grid: Map<number, Sample[]>; maxR: number } {
  const grid = new Map<number, Sample[]>();
  let maxR = 0;
  const add = (x: number, y: number, r: number) => {
    const k = Math.floor(x / CELL) * 73856093 ^ Math.floor(y / CELL) * 19349663;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push({ x, y, r });
    if (r > maxR) maxR = r;
  };
  for (const e of build.edges) {
    const ed = e.edge;
    const pair = ed.pairId ? build.edgeById.get(ed.pairId) : undefined;
    if (pair && pair.edge.id < ed.id) continue;
    const r = pair ? Math.max(e.outer, pair.outer) : Math.max(Math.abs(e.inner), Math.abs(e.outer));
    const pts = e.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L / SAMPLE));
      for (let k = 0; k <= n; k++) add(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r);
    }
  }
  for (const n of build.nodes) if (n.r > 0) add(n.node.x, n.node.y, n.r);
  return { grid, maxR };
}

function blocksRoad(poly: P2[], grid: Map<number, Sample[]>, maxR: number): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const pad = maxR;
  for (let cx = Math.floor((minX - pad) / CELL); cx <= Math.floor((maxX + pad) / CELL); cx++) {
    for (let cy = Math.floor((minY - pad) / CELL); cy <= Math.floor((maxY + pad) / CELL); cy++) {
      const l = grid.get(cx * 73856093 ^ cy * 19349663);
      if (!l) continue;
      for (const s of l) {
        if (s.x < minX - s.r || s.x > maxX + s.r || s.y < minY - s.r || s.y > maxY + s.r) continue;
        if (pointInPolygon(poly, s.x, s.y)) return true;
        if (distToPolygonEdge(poly, s.x, s.y) < s.r - TOLERANCE) return true;
      }
    }
  }
  return false;
}

const triCache = new WeakMap<BuildingFootprint[], (number[][] | null)[]>();

/** Roof triangulations, computed once per footprint list (edits only re-run the road filter). */
function triangulated(list: BuildingFootprint[]): (number[][] | null)[] {
  let t = triCache.get(list);
  if (!t) {
    t = list.map((f) => {
      if (f.pts.length < 3) return null;
      try {
        const tris = THREE.ShapeUtils.triangulateShape(f.pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
        return tris.length ? tris : null;
      } catch {
        return null;
      }
    });
    triCache.set(list, t);
  }
  return t;
}

export interface FootprintMesh {
  geometry: THREE.BufferGeometry;
  kept: number;
  dropped: number;
}

export function buildFootprints(list: BuildingFootprint[], build: RoadBuild): FootprintMesh {
  const { grid, maxR } = roadSamples(build);
  const block = rgb(palette.block);
  const ink = rgb(palette.ink);
  const paper = rgb(palette.paper);
  const tint: Record<BuildingFootprint['kind'], RGB> = {
    house: mixRGB(block, paper, 0.35),
    apartments: mixRGB(block, rgb('#cfc8bb'), 0.5),
    commercial: mixRGB(block, rgb('#d9cbb6'), 0.55),
    civic: mixRGB(block, rgb('#c9ccd0'), 0.55),
    minor: mixRGB(block, paper, 0.15),
    other: block,
  };

  const allTris = triangulated(list);
  let nv = 0, ni = 0;
  const keep: { f: BuildingFootprint; tris: number[][] }[] = [];
  let dropped = 0;
  list.forEach((f, i) => {
    const tris = allTris[i];
    if (!tris) { dropped++; return; }
    if (blocksRoad(f.pts as P2[], grid, maxR)) { dropped++; return; }
    keep.push({ f, tris });
    nv += f.pts.length * 5; // top + 4 per side quad
    ni += tris.length * 3 + f.pts.length * 6;
  });

  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, ii = 0;
  const put = (x: number, h: number, y: number, nx: number, ny: number, nz: number, c: RGB) => {
    const o = v * 3;
    pos[o] = x; pos[o + 1] = h; pos[o + 2] = -y;
    nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
    return v++;
  };
  for (const { f, tris } of keep) {
    const poly = f.pts;
    const cx = poly[0][0], cy = poly[0][1];
    const t = hash01(cx, cy, 11);
    const base = mixRGB(tint[f.kind], ink, 0.02 + t * 0.07);
    const top = mixRGB(base, paper, 0.18);
    const side = base;
    const foot: RGB = [side[0] * 0.8, side[1] * 0.8, side[2] * 0.8];
    const h1 = BASE + f.h;
    const t0 = v;
    for (const p of poly) put(p[0], h1, p[1], 0, 1, 0, top);
    for (const tr of tris) { idx[ii++] = t0 + tr[0]; idx[ii++] = t0 + tr[1]; idx[ii++] = t0 + tr[2]; }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      // CCW polygon: outward (sim) = (ey, -ex); three normal = (nx, 0, -ny)
      const nx = ey / el, nz = ex / el;
      const i0 = put(a[0], BASE, a[1], nx, 0, nz, foot);
      const i1 = put(b[0], BASE, b[1], nx, 0, nz, foot);
      const i2 = put(b[0], h1, b[1], nx, 0, nz, side);
      const i3 = put(a[0], h1, a[1], nx, 0, nz, side);
      idx[ii++] = i0; idx[ii++] = i1; idx[ii++] = i2;
      idx[ii++] = i0; idx[ii++] = i2; idx[ii++] = i3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
  g.computeBoundingSphere();
  return { geometry: g, kept: keep.length, dropped };
}
