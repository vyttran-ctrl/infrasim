// Low-level 2D polyline helpers used by the road/block builders. All in sim
// coordinates (x east, y north, metres). Right normal of direction (dx, dy)
// is (dy, -dx), matching src/sim/geometry.ts.

export type P2 = [number, number];

export interface Strip {
  /** sampled centreline points */
  pts: P2[];
  /** per-point miter normal (right-pointing) scaled by miter factor */
  nrm: P2[];
  /** cumulative distance per point */
  cum: number[];
  length: number;
}

const MITER_LIMIT = 3;

export function cumulative(pts: P2[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

/** Remove consecutive duplicates (zero-length segments break normals). */
export function dedupe(pts: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) out.push(p);
  }
  return out;
}

/** Point at distance s along pts (with precomputed cum). */
export function sampleAt(pts: P2[], cum: number[], s: number): { p: P2; dir: P2; seg: number } {
  const L = cum[cum.length - 1];
  const d = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = (d - cum[i - 1]) / seg;
  const a = pts[i - 1];
  const b = pts[i];
  return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg], seg: i - 1 };
}

/** Sub-polyline between distances s0..s1 (s0 < s1). */
export function subPolyline(pts: P2[], cum: number[], s0: number, s1: number): P2[] {
  const out: P2[] = [sampleAt(pts, cum, s0).p];
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(pts[i]);
  }
  out.push(sampleAt(pts, cum, s1).p);
  return dedupe(out);
}

/** Builds miter normals for a polyline. */
export function makeStrip(raw: P2[]): Strip | null {
  const pts = dedupe(raw);
  if (pts.length < 2) return null;
  const n = pts.length;
  const segN: P2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segN.push([dy / l, -dx / l]);
  }
  const nrm: P2[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) nrm.push(segN[0]);
    else if (i === n - 1) nrm.push(segN[n - 2]);
    else {
      const a = segN[i - 1];
      const b = segN[i];
      let mx = a[0] + b[0];
      let my = a[1] + b[1];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { nrm.push(b); continue; }
      mx /= ml; my /= ml;
      const cos = mx * b[0] + my * b[1];
      const f = Math.min(MITER_LIMIT, 1 / Math.max(1e-3, cos));
      nrm.push([mx * f, my * f]);
    }
  }
  const cum = cumulative(pts);
  return { pts, nrm, cum, length: cum[n - 1] };
}

/** Signed lateral offset of point q from polyline (positive = right of travel). */
export function lateralOffset(pts: P2[], qx: number, qy: number): number {
  let best = Infinity;
  let side = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / l2));
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(qx - px, qy - py);
    if (d < best) {
      best = d;
      // right normal (dy,-dx): positive dot = right side
      side = (qx - px) * dy - (qy - py) * dx >= 0 ? 1 : -1;
    }
  }
  return best * side;
}

export function distToPolyline(pts: P2[], qx: number, qy: number): number {
  return Math.abs(lateralOffset(pts, qx, qy));
}

export function polygonArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return a / 2;
}

export function pointInPolygon(poly: P2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPolygonEdge(poly: P2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

function segsIntersect(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function selfIntersects(poly: P2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsIntersect(a, b, poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Insets a CCW polygon by a per-side distance (side i = poly[i] -> poly[i+1]).
 * Returns null when the result degenerates.
 */
export function insetPolygon(poly: P2[], dist: number[]): P2[] | null {
  const n = poly.length;
  if (n < 3) return null;
  // inward normal of a CCW polygon side (dx,dy) is the left normal (-dy, dx)
  const lines: { p: P2; d: P2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    lines.push({ p: [a[0] + nx * dist[i], a[1] + ny * dist[i]], d: [dx / l, dy / l] });
  }
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i - 1 + n) % n];
    const L1 = lines[i];
    const den = L0.d[0] * L1.d[1] - L0.d[1] * L1.d[0];
    if (Math.abs(den) < 0.08) {
      // nearly collinear: take the offset point on L1
      out.push(L1.p);
      continue;
    }
    const t = ((L1.p[0] - L0.p[0]) * L1.d[1] - (L1.p[1] - L0.p[1]) * L1.d[0]) / den;
    out.push([L0.p[0] + L0.d[0] * t, L0.p[1] + L0.d[1] * t]);
  }
  const res = dedupe(out);
  if (res.length < 3) return null;
  const a0 = polygonArea(poly);
  const a1 = polygonArea(res);
  if (a1 <= 20 || a1 >= a0) return null;
  if (res.length < 200 && selfIntersects(res)) return null;
  for (const p of res) if (!pointInPolygon(poly, p[0], p[1])) return null;
  return res;
}

/** Deterministic hash → [0,1). */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(Math.floor(a * 7.13) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(Math.floor(b * 3.71) + c * 1013, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
