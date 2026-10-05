// Geometry accumulators. Sim (x, y) maps to three (x, h, -y).

import * as THREE from 'three';
import type { P2, Strip } from './polyline';
import { makeStrip, subPolyline } from './polyline';

export type RGB = [number, number, number];

const tmpColor = new THREE.Color();
/** Hex -> linear RGB triple (vertex colours live in the linear working space). */
export function rgb(hex: string): RGB {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Flat (horizontal) triangles with vertex colours. */
export class FlatBuf {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  get vertexCount() { return this.pos.length / 3; }

  private v(x: number, y: number, h: number, c: RGB) {
    this.pos.push(x, h, -y);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  quad(a: P2, b: P2, c: P2, d: P2, h: number, color: RGB) {
    const i0 = this.v(a[0], a[1], h, color);
    const i1 = this.v(b[0], b[1], h, color);
    const i2 = this.v(c[0], c[1], h, color);
    const i3 = this.v(d[0], d[1], h, color);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Ribbon between lateral offsets offA..offB (right positive) along a strip. */
  ribbon(strip: Strip, offA: number, offB: number, h: number, color: RGB) {
    const { pts, nrm } = strip;
    const base = this.vertexCount;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const [nx, ny] = nrm[i];
      this.v(x + nx * offA, y + ny * offA, h, color);
      this.v(x + nx * offB, y + ny * offB, h, color);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  /** Ribbon over a sub-range [s0, s1] of a raw polyline. */
  ribbonRange(pts: P2[], cum: number[], s0: number, s1: number, offA: number, offB: number, h: number, color: RGB) {
    if (s1 - s0 < 0.05) return;
    const strip = makeStrip(subPolyline(pts, cum, s0, s1));
    if (strip) this.ribbon(strip, offA, offB, h, color);
  }

  /** Dashed line: dash/gap lengths in metres along the polyline. */
  dashed(pts: P2[], cum: number[], s0: number, s1: number, off: number, width: number, dash: number, gap: number, h: number, color: RGB) {
    const period = dash + gap;
    const len = s1 - s0;
    if (len <= dash) return;
    const n = Math.floor((len + gap) / period);
    const start = s0 + (len - (n * period - gap)) / 2;
    for (let k = 0; k < n; k++) {
      const a = start + k * period;
      this.ribbonRange(pts, cum, a, a + dash, off - width / 2, off + width / 2, h, color);
    }
  }

  disc(x: number, y: number, r: number, h: number, color: RGB, seg = 40) {
    const c = this.v(x, y, h, color);
    const base = this.vertexCount;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.v(x + Math.cos(a) * r, y + Math.sin(a) * r, h, color);
    }
    for (let i = 0; i < seg; i++) this.idx.push(c, base + i, base + ((i + 1) % seg));
  }

  ring(x: number, y: number, r0: number, r1: number, h: number, color: RGB, seg = 48) {
    const base = this.vertexCount;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      this.v(x + c * r0, y + s * r0, h, color);
      this.v(x + c * r1, y + s * r1, h, color);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % seg) * 2;
      this.idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }

  /** Dashed ring (roundabout yield / lane lines). */
  dashedRing(x: number, y: number, r: number, width: number, dash: number, gap: number, h: number, color: RGB) {
    const circ = Math.PI * 2 * r;
    const n = Math.max(4, Math.floor(circ / (dash + gap)));
    const step = (Math.PI * 2) / n;
    const da = step * (dash / (dash + gap));
    const p = (a: number, rr: number): P2 => [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
    for (let k = 0; k < n; k++) {
      const a0 = k * step, a1 = a0 + da;
      this.quad(p(a0, r - width / 2), p(a0, r + width / 2), p(a1, r + width / 2), p(a1, r - width / 2), h, color);
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Lit solids (boxes, prisms) with explicit normals and vertex colours. */
export class SolidBuf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  private v(x: number, h: number, z: number, nx: number, ny: number, nz: number, c: RGB) {
    this.pos.push(x, h, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  /**
   * Box centred at sim (x, y), base at height h0; `len` along sim heading
   * `rot`, `wid` across it, `ht` tall. Bottom edges darkened (fake AO).
   */
  box(x: number, y: number, h0: number, len: number, wid: number, ht: number, rot: number, color: RGB, aoBottom = 0.82) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const corner = (u: number, w: number): P2 => [x + c * u + s * w, y + s * u - c * w];
    const hl = len / 2, hw = wid / 2;
    // CCW in sim
    const P = [corner(-hl, hw), corner(-hl, -hw), corner(hl, -hw), corner(hl, hw)];
    if (polyAreaSign(P) < 0) P.reverse();
    this.prismPts(P, h0, h0 + ht, color, color, aoBottom);
  }

  /** Extruded CCW polygon (sim coordinates) from h0 to h1. */
  prism(poly: P2[], h0: number, h1: number, top: RGB, side: RGB, ao = 0.85) {
    this.prismPts(poly, h0, h1, top, side, ao);
  }

  private prismPts(poly: P2[], h0: number, h1: number, top: RGB, side: RGB, ao: number) {
    const base = this.pos.length / 3;
    for (const p of poly) this.v(p[0], h1, -p[1], 0, 1, 0, top);
    if (poly.length === 4) {
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      // CCW in sim maps to an upward-facing triangle in three
      for (const t of tris) this.idx.push(base + t[0], base + t[1], base + t[2]);
    }
    const dark: RGB = [side[0] * ao, side[1] * ao, side[2] * ao];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      // CCW polygon: outward = right normal (ey, -ex)
      this.sideQuad(a, b, h0, h1, ey / el, -ex / el, side, dark);
    }
  }

  private sideQuad(a: P2, b: P2, h0: number, h1: number, nx: number, ny: number, top: RGB, bottom: RGB) {
    const i0 = this.v(a[0], h0, -a[1], nx, 0, -ny, bottom);
    const i1 = this.v(b[0], h0, -b[1], nx, 0, -ny, bottom);
    const i2 = this.v(b[0], h1, -b[1], nx, 0, -ny, top);
    const i3 = this.v(a[0], h1, -a[1], nx, 0, -ny, top);
    // triangle (i0,i1,i2) has normal proportional to (ay, 0, ax); outward is (nx, 0, -ny)
    const ax = b[0] - a[0], ay = b[1] - a[1];
    if (ay * nx - ax * ny > 0) this.idx.push(i0, i1, i2, i0, i2, i3);
    else this.idx.push(i0, i2, i1, i0, i3, i2);
  }

  cylinder(x: number, y: number, h0: number, r: number, ht: number, top: RGB, side: RGB, seg = 32) {
    const poly: P2[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      poly.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    this.prismPts(poly, h0, h0 + ht, top, side, 0.85);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function polyAreaSign(P: P2[]): number {
  let a = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  return a;
}
