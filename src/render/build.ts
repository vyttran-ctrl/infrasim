// Turns a RoadNetwork into merged render geometry. Pure (no React); called
// once per network identity. Everything is in sim coordinates until the
// buffers map it to three space.

import type * as THREE from 'three';
import { palette, zoneColors } from '../app/palette';
import { LANE_WIDTH, ROUNDABOUT_RING_WIDTH, edgePolyline, junctionLayout, laneOffset, nodeIndex } from '../sim/geometry';
import type { NetEdge, NetNode, RoadNetwork } from '../sim/types';
import { FlatBuf, SolidBuf, mixRGB, rgb, type RGB } from './buffers';
import {
  cumulative,
  distToPolygonEdge,
  hash01,
  insetPolygon,
  makeStrip,
  pointInPolygon,
  polygonArea,
  sampleAt,
  type P2,
} from './polyline';

// Heights of the flat layers (draw order is enforced by renderOrder, these
// only keep things visually stacked when depth testing against solids).
export const H = {
  asphalt: 0.03,
  fill: 0.05,
  heat: 0.07,
  marking: 0.09,
  pick: 0.12,
  highlight: 0.32, // above block slab tops (0.22)
};

export interface EdgeInfo {
  index: number;
  edge: NetEdge;
  pts: P2[];
  cum: number[];
  length: number;
  /** lateral span (right positive) of this directed edge's own lanes */
  inner: number;
  outer: number;
  /** distances from each end where the junction box ends */
  trimA: number;
  trimB: number;
  /** distance from the `to` node of the (visual) stop line */
  stopD: number;
}

export interface NodeInfo {
  index: number;
  node: NetNode;
  /** junction disc radius (0 for boundary nodes) */
  r: number;
  degree: number;
}

export interface Range { key: number; v0: number; v1: number }

export interface Crossing { node: number; a: P2; b: P2 }

export interface Building { x: number; y: number; w: number; d: number; h: number; rot: number; color: RGB }

export interface Label { text: string; x: number; y: number; angle: number; size: number }

export interface Street { a: number; b: number }

export interface RoadBuild {
  edges: EdgeInfo[];
  nodes: NodeInfo[];
  edgeById: Map<string, EdgeInfo>;
  /** EdgeInfo by network.edges index (undefined for invalid edges) */
  byIndex: (EdgeInfo | undefined)[];
  nodeById: Map<string, NodeInfo>;
  asphalt: THREE.BufferGeometry;
  fills: THREE.BufferGeometry;
  markings: THREE.BufferGeometry;
  stopBars: THREE.BufferGeometry;
  stopBarRanges: Range[]; // key = edge index
  zebra: THREE.BufferGeometry;
  zebraRanges: Range[]; // key = node index
  heat: THREE.BufferGeometry;
  heatRanges: Range[]; // key = edge index
  solids: THREE.BufferGeometry;
  /** signal lamp positions (three coords) per signalized approach */
  lamps: { edge: number; x: number; y: number; z: number; rot: number }[];
  crossings: Crossing[];
  buildings: Building[];
  labels: Label[];
  streetPick: THREE.BufferGeometry;
  triStreet: Int32Array;
  streets: Street[];
  nodePick: THREE.BufferGeometry;
  triNode: Int32Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const SIDEWALK = 2.5;

function halfWidthAt(e: NetEdge, byId: Map<string, NetEdge>): number {
  if (e.pairId) {
    const p = byId.get(e.pairId);
    return Math.max(e.lanes, p ? p.lanes : e.lanes) * LANE_WIDTH;
  }
  return (e.lanes * LANE_WIDTH) / 2;
}

function lateralSpan(e: NetEdge): [number, number] {
  const w = e.lanes * LANE_WIDTH;
  return e.pairId ? [0, w] : [-w / 2, w / 2];
}

export function buildRoads(net: RoadNetwork): RoadBuild {
  const nodeMap = nodeIndex(net);
  const edgeMap = new Map(net.edges.map((e) => [e.id, e]));
  const nodeIdx = new Map(net.nodes.map((n, i) => [n.id, i]));

  // ---------------------------------------------------------- node radii (shared with the sim)
  const layout = junctionLayout(net);
  const degree = new Array(net.nodes.length).fill(0);
  const maxW = new Array(net.nodes.length).fill(0);
  const streetsAt: Set<string>[] = net.nodes.map(() => new Set());
  for (const e of net.edges) {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
    const hw = halfWidthAt(e, edgeMap);
    const key = e.pairId && e.pairId < e.id ? e.pairId : e.id;
    for (const nid of [e.from, e.to]) {
      const i = nodeIdx.get(nid)!;
      maxW[i] = Math.max(maxW[i], hw);
      streetsAt[i].add(key);
    }
  }
  const nodes: NodeInfo[] = net.nodes.map((node, index) => {
    const deg = streetsAt[index].size;
    degree[index] = deg;
    return { index, node, r: layout.nodeRadius[index], degree: deg };
  });
  const nodeById = new Map(nodes.map((n) => [n.node.id, n]));

  // ---------------------------------------------------------- edge info
  const edges: EdgeInfo[] = [];
  const edgeById = new Map<string, EdgeInfo>();
  net.edges.forEach((edge, index) => {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) return;
    const poly = edgePolyline(edge, nodeMap);
    const pts = poly.pts.map((p) => [p[0], p[1]] as P2);
    const cum = cumulative(pts);
    const [inner, outer] = lateralSpan(edge);
    const A = nodeById.get(edge.from)!;
    const B = nodeById.get(edge.to)!;
    const stopD = layout.stopSetback[index];
    const info: EdgeInfo = { index, edge, pts, cum, length: cum[cum.length - 1], inner, outer, trimA: A.r, trimB: B.r, stopD };
    edges.push(info);
    edgeById.set(edge.id, info);
  });

  const C = {
    asphalt: rgb(palette.asphalt),
    closed: rgb(palette.asphaltClosed),
    junction: rgb(palette.junction),
    marking: rgb(palette.marking),
    yellow: rgb(palette.markingYellow),
    bus: rgb(palette.busLane),
    bike: rgb(palette.bikeLane),
    block: rgb(palette.block),
    ink: rgb(palette.ink),
    paper: rgb(palette.paper),
    red: rgb(palette.closed),
  };
  const zebraBase = mixRGB(C.marking, C.asphalt, 0.45);

  const asphalt = new FlatBuf();
  const fills = new FlatBuf();
  const mark = new FlatBuf();
  const stop = new FlatBuf();
  const zebra = new FlatBuf();
  const heat = new FlatBuf();
  const solid = new SolidBuf();
  const stopBarRanges: Range[] = [];
  const zebraRanges: Range[] = [];
  const heatRanges: Range[] = [];
  const lamps: RoadBuild['lamps'] = [];
  const crossings: Crossing[] = [];

  // ---------------------------------------------------------- asphalt ribbons (all edges first, discs on top)
  for (const e of edges) {
    const strip = makeStrip(e.pts);
    if (!strip) continue;
    // extend slightly toward the centreline so paired halves never leave a seam
    const inner = e.edge.pairId ? -0.05 : e.inner;
    asphalt.ribbon(strip, inner, e.outer, H.asphalt, e.edge.closed ? C.closed : C.asphalt);
  }
  for (const n of nodes) {
    if (n.r <= 0) continue;
    if (n.node.kind === 'roundabout') {
      const ringW = ROUNDABOUT_RING_WIDTH;
      asphalt.ring(n.node.x, n.node.y, n.r - ringW, n.r + 0.5, H.asphalt, C.junction, 56);
    } else {
      asphalt.disc(n.node.x, n.node.y, n.r, H.asphalt, n.degree >= 3 ? C.junction : C.asphalt, n.degree >= 3 ? 40 : 24);
    }
  }

  // ---------------------------------------------------------- per-edge lanes, markings, overlay
  for (const e of edges) {
    const ed = e.edge;
    const s0 = e.trimA;
    const s1 = e.length - e.trimB;
    if (s1 - s0 < 1) continue;
    const { pts, cum } = e;
    const faded = ed.closed;
    const white = faded ? mixRGB(C.marking, C.closed, 0.5) : C.marking;

    // heat overlay strip
    const hv0 = heat.vertexCount;
    heat.ribbonRange(pts, cum, s0, s1, e.inner + (ed.pairId ? 0.35 : 0.3), e.outer - 0.3, H.heat, C.asphalt);
    heatRanges.push({ key: e.index, v0: hv0, v1: heat.vertexCount });

    // lanes
    for (let l = 0; l < ed.lanes; l++) {
      const c = laneOffset(ed, l);
      const isBike = ed.bikeLane && l === 0;
      const isBus = !isBike && l < ed.busLanes + (ed.bikeLane ? 1 : 0);
      if (!faded && (isBike || isBus)) {
        fills.ribbonRange(pts, cum, s0, s1, c - LANE_WIDTH / 2, c + LANE_WIDTH / 2, H.fill, isBike ? C.bike : C.bus);
      }
      if (l < ed.lanes - 1) {
        // boundary between lane l and l+1 (l+1 is to the left)
        const b = c - LANE_WIDTH / 2;
        const nextBus = l + 1 < ed.busLanes + (ed.bikeLane ? 1 : 0);
        if (isBike) {
          mark.ribbonRange(pts, cum, s0, s1, b - 0.08, b + 0.08, H.marking, white);
          mark.ribbonRange(pts, cum, s0, s1, b + 0.55, b + 0.67, H.marking, white);
        } else if (isBus && !nextBus) {
          mark.ribbonRange(pts, cum, s0, s1, b - 0.13, b + 0.13, H.marking, white);
        } else {
          mark.dashed(pts, cum, s0, s1, b, 0.14, 3, 6, H.marking, white);
        }
      }
    }
    // centreline (once per pair)
    if (ed.pairId && ed.id < ed.pairId) {
      const y = faded ? mixRGB(C.yellow, C.closed, 0.5) : C.yellow;
      mark.ribbonRange(pts, cum, s0, s1, -0.3, -0.12, H.marking, y);
      mark.ribbonRange(pts, cum, s0, s1, 0.12, 0.3, H.marking, y);
    } else if (ed.pairId && !edgeById.has(ed.pairId)) {
      mark.ribbonRange(pts, cum, s0, s1, 0.12, 0.3, H.marking, C.yellow);
    }

    // stop / yield line at the downstream node
    const B = nodeById.get(ed.to)!;
    const sl = e.length - e.stopD;
    if (sl > s0 + 1) {
      const kind = B.node.kind;
      if (kind === 'signal') {
        const v0 = stop.vertexCount;
        stop.ribbonRange(pts, cum, sl - 0.6, sl, e.inner + (ed.pairId ? 0.35 : 0), e.outer, H.marking, C.marking);
        stopBarRanges.push({ key: e.index, v0, v1: stop.vertexCount });
        // post + lamp at the right curb
        const at = sampleAt(pts, cum, sl - 0.3);
        const rx = at.dir[1], ry = -at.dir[0];
        const px = at.p[0] + rx * (e.outer + 0.9), py = at.p[1] + ry * (e.outer + 0.9);
        const heading = Math.atan2(at.dir[1], at.dir[0]);
        solid.box(px, py, 0, 0.28, 0.28, 4.2, heading, C.ink, 0.9);
        solid.box(px, py, 0, 0.9, 0.9, 0.25, heading, mixRGB(C.ink, C.paper, 0.4), 0.9);
        lamps.push({ edge: e.index, x: px, y: 4.9, z: -py, rot: heading });
      } else if (kind === 'priority') {
        mark.ribbonRange(pts, cum, sl - 0.5, sl, e.inner + (ed.pairId ? 0.35 : 0), e.outer, H.marking, white);
      } else if (kind === 'roundabout') {
        // yield: dashed transverse line
        const span = e.outer - (e.inner + (ed.pairId ? 0.35 : 0));
        const n = Math.max(2, Math.round(span / 1.2));
        for (let k = 0; k < n; k++) {
          const o0 = e.inner + (ed.pairId ? 0.35 : 0) + (k / n) * span;
          mark.ribbonRange(pts, cum, sl - 0.9, sl - 0.3, o0, o0 + (span / n) * 0.55, H.marking, white);
        }
      }
    }

    // closed: barriers at both ends
    if (ed.closed) {
      for (const s of [s0 + 1.2, s1 - 1.2]) {
        const at = sampleAt(pts, cum, s);
        const rx = at.dir[1], ry = -at.dir[0];
        const heading = Math.atan2(at.dir[1], at.dir[0]);
        const lo = e.inner + 0.3, hi = e.outer - 0.3;
        const n = Math.max(2, Math.round((hi - lo) / 0.9));
        const step = (hi - lo) / n;
        for (let k = 0; k < n; k++) {
          const o = lo + step * (k + 0.5);
          solid.box(at.p[0] + rx * o, at.p[1] + ry * o, 0, 0.45, step * 0.96, 1.0, heading, k % 2 === 0 ? C.red : C.marking, 0.85);
        }
      }
    }
  }

  // ---------------------------------------------------------- zebra crossings
  const crossingFor = (e: EdgeInfo, atEnd: boolean) => {
    const ed = e.edge;
    const nodeI = nodeIdx.get(atEnd ? ed.to : ed.from)!;
    const nInfo = nodes[nodeI];
    const near = nInfo.r > 0 ? maxW[nodeI] + 0.6 : 2;
    const far = near + 3;
    if (e.length < far * 2 + 2) return;
    const sA = atEnd ? e.length - far : near;
    const sB = atEnd ? e.length - near : far;
    let lo = e.inner, hi = e.outer;
    if (ed.pairId) {
      const p = edgeById.get(ed.pairId);
      lo = -(p ? p.outer : e.outer);
    }
    const v0 = zebra.vertexCount;
    const stripeW = 0.55;
    for (let o = lo + 0.35; o + stripeW <= hi - 0.2; o += stripeW * 2) {
      zebra.ribbonRange(e.pts, e.cum, sA, sB, o, o + stripeW, H.marking, zebraBase);
    }
    zebraRanges.push({ key: nodeI, v0, v1: zebra.vertexCount });
    const mid = sampleAt(e.pts, e.cum, (sA + sB) / 2);
    const rx = mid.dir[1], ry = -mid.dir[0];
    crossings.push({
      node: nodeI,
      a: [mid.p[0] + rx * (lo - 0.8), mid.p[1] + ry * (lo - 0.8)],
      b: [mid.p[0] + rx * (hi + 0.8), mid.p[1] + ry * (hi + 0.8)],
    });
  };
  for (const e of edges) {
    if (nodeById.get(e.edge.to)!.node.pedCrossing) crossingFor(e, true);
    if (!e.edge.pairId && nodeById.get(e.edge.from)!.node.pedCrossing) crossingFor(e, false);
  }

  // ---------------------------------------------------------- roundabout islands
  for (const n of nodes) {
    if (n.node.kind !== 'roundabout') continue;
    const ringW = ROUNDABOUT_RING_WIDTH;
    const ri = n.r - ringW;
    solid.cylinder(n.node.x, n.node.y, 0, ri, 0.35, mixRGB(C.bike, C.block, 0.35), C.block, 40);
    mark.dashedRing(n.node.x, n.node.y, n.r - ringW / 2, 0.14, 2, 3, H.marking, C.marking);
  }

  // ---------------------------------------------------------- city blocks & buildings
  const { blocks, buildings } = buildBlocks(net, edges, edgeMap, nodes);
  const blockTop = C.block;
  const blockSide = mixRGB(C.block, C.ink, 0.12);
  for (const poly of blocks) solid.prism(poly, 0, 0.22, blockTop, blockSide, 0.82);

  // ---------------------------------------------------------- labels
  const labels = buildLabels(edges);

  // ---------------------------------------------------------- pick meshes
  const streetPickBuf = new FlatBuf();
  const triStreetArr: number[] = [];
  const streets: Street[] = [];
  for (const e of edges) {
    const ed = e.edge;
    if (ed.pairId && edgeById.has(ed.pairId) && ed.pairId < ed.id) continue;
    const pair = ed.pairId ? edgeById.get(ed.pairId) : undefined;
    const strip = makeStrip(e.pts);
    if (!strip) continue;
    const si = streets.length;
    streets.push({ a: e.index, b: pair ? pair.index : -1 });
    const t0 = streetPickBuf.idx.length / 3;
    const lo = pair ? -pair.outer - 1 : e.inner - 1;
    streetPickBuf.ribbon(strip, lo, e.outer + 1, H.pick, C.ink);
    const t1 = streetPickBuf.idx.length / 3;
    for (let t = t0; t < t1; t++) triStreetArr.push(si);
  }
  const nodePickBuf = new FlatBuf();
  const triNodeArr: number[] = [];
  for (const n of nodes) {
    const r = n.r > 0 ? n.r + 0.5 : 6;
    const t0 = nodePickBuf.idx.length / 3;
    nodePickBuf.disc(n.node.x, n.node.y, r, H.pick + 0.02, C.ink, 20);
    const t1 = nodePickBuf.idx.length / 3;
    for (let t = t0; t < t1; t++) triNodeArr.push(n.index);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of net.nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  for (const e of edges) for (const p of e.pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }

  return {
    edges,
    nodes,
    edgeById,
    byIndex: (() => { const a: (EdgeInfo | undefined)[] = new Array(net.edges.length); for (const e of edges) a[e.index] = e; return a; })(),
    nodeById,
    asphalt: asphalt.toGeometry(),
    fills: fills.toGeometry(),
    markings: mark.toGeometry(),
    stopBars: stop.toGeometry(),
    stopBarRanges,
    zebra: zebra.toGeometry(),
    zebraRanges,
    heat: heat.toGeometry(),
    heatRanges,
    solids: solid.toGeometry(),
    lamps,
    crossings,
    buildings,
    labels,
    streetPick: streetPickBuf.toGeometry(),
    triStreet: Int32Array.from(triStreetArr),
    streets,
    nodePick: nodePickBuf.toGeometry(),
    triNode: Int32Array.from(triNodeArr),
    bounds: { minX, minY, maxX, maxY },
  };
}

export function disposeBuild(b: RoadBuild) {
  for (const g of [b.asphalt, b.fills, b.markings, b.stopBars, b.zebra, b.heat, b.solids, b.streetPick, b.nodePick]) g.dispose();
}

// ============================================================ blocks

interface HalfEdge {
  from: number;
  to: number;
  pts: P2[];
  angle: number;
  width: number;
  twin: number;
}

/**
 * Finds the faces of the planar street graph (after pruning dead ends),
 * insets each by the street half-width + sidewalk and scatters a few
 * deterministic low buildings inside.
 */
function buildBlocks(net: RoadNetwork, edges: EdgeInfo[], edgeMap: Map<string, NetEdge>, nodeInfos: NodeInfo[]): { blocks: P2[][]; buildings: Building[] } {
  const blocks: P2[][] = [];
  const buildings: Building[] = [];
  if (net.nodes.length > 4000) return { blocks, buildings };
  const nodeIdx = new Map(net.nodes.map((n, i) => [n.id, i]));

  // undirected streets
  type S = { u: number; v: number; pts: P2[]; w: number };
  const streets: S[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const ed = e.edge;
    const u = nodeIdx.get(ed.from)!, v = nodeIdx.get(ed.to)!;
    if (u === v) continue;
    const key = ed.pairId ? [ed.id, ed.pairId].sort().join('|') : ed.id;
    if (seen.has(key)) continue;
    seen.add(key);
    streets.push({ u, v, pts: e.pts, w: halfWidthAt(ed, edgeMap) + SIDEWALK });
  }
  // prune dead ends iteratively
  const alive = streets.map(() => true);
  const deg = new Array(net.nodes.length).fill(0);
  streets.forEach((s) => { deg[s.u]++; deg[s.v]++; });
  let changed = true;
  while (changed) {
    changed = false;
    streets.forEach((s, i) => {
      if (alive[i] && (deg[s.u] <= 1 || deg[s.v] <= 1)) {
        alive[i] = false; deg[s.u]--; deg[s.v]--; changed = true;
      }
    });
  }
  const he: HalfEdge[] = [];
  streets.forEach((s, i) => {
    if (!alive[i]) return;
    const fwd = s.pts;
    const rev = [...s.pts].reverse();
    const a = he.length;
    he.push({ from: s.u, to: s.v, pts: fwd, angle: Math.atan2(fwd[1][1] - fwd[0][1], fwd[1][0] - fwd[0][0]), width: s.w, twin: a + 1 });
    he.push({ from: s.v, to: s.u, pts: rev, angle: Math.atan2(rev[1][1] - rev[0][1], rev[1][0] - rev[0][0]), width: s.w, twin: a });
  });
  const out: number[][] = net.nodes.map(() => []);
  he.forEach((h, i) => out[h.from].push(i));
  for (const list of out) list.sort((a, b) => he[a].angle - he[b].angle);
  const posInOut = new Int32Array(he.length);
  out.forEach((list) => list.forEach((h, k) => { posInOut[h] = k; }));

  const nodeGrid = makeNodeGrid(nodeInfos);
  const visited = new Uint8Array(he.length);
  for (let start = 0; start < he.length; start++) {
    if (visited[start]) continue;
    const poly: P2[] = [];
    const widths: number[] = [];
    let h = start;
    let guard = 0;
    let ok = true;
    do {
      visited[h] = 1;
      const H0 = he[h];
      for (let k = 0; k < H0.pts.length - 1; k++) { poly.push(H0.pts[k]); widths.push(H0.width); }
      const twin = H0.twin;
      const list = out[H0.to];
      const k = posInOut[twin];
      h = list[(k - 1 + list.length) % list.length];
      if (++guard > 400) { ok = false; break; }
    } while (h !== start);
    if (!ok || poly.length < 3) continue;
    const area = polygonArea(poly);
    if (area <= 0 || area > 4e6) continue; // outer face or huge
    const inset = insetPolygon(poly, widths);
    if (!inset) continue;
    const rounded = roundCorners(inset, nodeGrid);
    if (rounded) blocks.push(rounded);
  }

  // buildings
  if (net.edges.length > 1500) return { blocks, buildings };
  const C = { block: rgb(palette.block), ink: rgb(palette.ink), paper: rgb(palette.paper) };
  const tints = zoneColors.map(rgb);
  const cap = 1800;
  for (const poly of blocks) {
    if (buildings.length >= cap) break;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    // orientation from the longest side
    let best = 0, rot = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best) { best = l; rot = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    }
    const step = 20;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const ext = Math.hypot(maxX - minX, maxY - minY) / 2;
    for (let u = -ext; u <= ext; u += step) {
      for (let v = -ext; v <= ext; v += step) {
        const x = cx + cr * u - sr * v;
        const y = cy + sr * u + cr * v;
        const r0 = hash01(x, y, 1);
        if (r0 > 0.42) continue;
        const w = 7 + hash01(x, y, 2) * 7;
        const d = 7 + hash01(x, y, 3) * 6;
        if (!pointInPolygon(poly, x, y)) continue;
        if (distToPolygonEdge(poly, x, y) < Math.hypot(w, d) / 2 + 1.2) continue;
        const r4 = hash01(x, y, 4);
        const h = r4 > 0.93 ? 11 + r4 * 6 : 3 + hash01(x, y, 5) * 6;
        const t = hash01(x, y, 6);
        const base = mixRGB(C.block, C.ink, 0.05 + t * 0.1);
        const color = t > 0.6 ? mixRGB(base, tints[Math.floor(hash01(x, y, 7) * tints.length)], 0.22) : mixRGB(base, C.paper, 0.25);
        buildings.push({ x, y, w, d, h, rot, color });
        if (buildings.length >= cap) break;
      }
      if (buildings.length >= cap) break;
    }
  }
  return { blocks, buildings };
}

// ============================================================ labels

function buildLabels(edges: EdgeInfo[]): Label[] {
  const labels: Label[] = [];
  const byName = new Map<string, EdgeInfo[]>();
  const anyClass = edges.some((e) => e.edge.roadClass);
  for (const e of edges) {
    const ed = e.edge;
    if (!ed.name) continue;
    const arterial = anyClass ? ed.roadClass === 'arterial' : ed.lanes >= 2;
    if (!arterial) continue;
    if (ed.pairId && ed.pairId < ed.id) continue; // one label per street direction pair
    const list = byName.get(ed.name) ?? [];
    list.push(e);
    byName.set(ed.name, list);
  }
  for (const [name, list] of byName) {
    // label every ~350 m of street length, on the longest segments
    const sorted = [...list].sort((a, b) => b.length - a.length);
    const total = list.reduce((s, e) => s + e.length, 0);
    const n = Math.max(1, Math.min(4, Math.round(total / 350)));
    const placed: P2[] = [];
    for (const e of sorted) {
      if (placed.length >= n) break;
      if (e.length < 40) continue;
      const mid = sampleAt(e.pts, e.cum, e.length / 2);
      if (placed.some((p) => Math.hypot(p[0] - mid.p[0], p[1] - mid.p[1]) < 200)) continue;
      let angle = Math.atan2(mid.dir[1], mid.dir[0]);
      // keep text upright on screen (camera looks north by default)
      if (angle > Math.PI / 2 + 0.01) angle -= Math.PI;
      if (angle < -Math.PI / 2 + 0.01) angle += Math.PI;
      const off = e.outer + SIDEWALK + 2.2;
      const rx = mid.dir[1], ry = -mid.dir[0];
      placed.push(mid.p);
      labels.push({ text: name, x: mid.p[0] + rx * off, y: mid.p[1] + ry * off, angle, size: 4.2 });
    }
  }
  return labels;
}

// ============================================================ corner rounding

interface NodeGrid { cell: number; map: Map<string, { x: number; y: number; R: number }[]> }

function makeNodeGrid(nodes: NodeInfo[]): NodeGrid {
  const cell = 60;
  const map = new Map<string, { x: number; y: number; R: number }[]>();
  for (const n of nodes) {
    if (n.r <= 0) continue;
    const R = n.r + (n.node.kind === 'roundabout' ? SIDEWALK : 1.5);
    const cx = Math.floor(n.node.x / cell), cy = Math.floor(n.node.y / cell);
    const k = cx + ',' + cy;
    const l = map.get(k) ?? [];
    l.push({ x: n.node.x, y: n.node.y, R });
    map.set(k, l);
  }
  return { cell, map };
}

function nearNode(g: NodeGrid, p: P2): { x: number; y: number; R: number } | null {
  const cx = Math.floor(p[0] / g.cell), cy = Math.floor(p[1] / g.cell);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const l = g.map.get(cx + i + ',' + (cy + j));
    if (!l) continue;
    for (const n of l) if (Math.hypot(p[0] - n.x, p[1] - n.y) < n.R) return n;
  }
  return null;
}

/** Parameter t in [0,1] along a->b where |p(t) - c| = R, nearest to the given end (0 or 1). */
function circleHit(a: P2, b: P2, c: { x: number; y: number; R: number }, fromEnd: 0 | 1): number | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c.x, fy = a[1] - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.R * c.R;
  const disc = B * B - 4 * A * C;
  if (A < 1e-9 || disc < 0) return null;
  const sq = Math.sqrt(disc);
  const ts = [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t >= 0 && t <= 1);
  if (!ts.length) return null;
  return fromEnd === 1 ? Math.max(...ts) : Math.min(...ts);
}

/** Replaces block vertices that fall inside a junction circle with an arc around it. */
function roundCorners(poly: P2[], g: NodeGrid): P2[] | null {
  if (g.map.size === 0) return poly;
  const out: P2[] = [];
  const n = poly.length;
  let touched = false;
  for (let i = 0; i < n; i++) {
    const v = poly[i];
    const c = nearNode(g, v);
    if (!c) { out.push(v); continue; }
    touched = true;
    const prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const t0 = circleHit(prev, v, c, 0);
    const t1 = circleHit(v, next, c, 1);
    if (t0 === null || t1 === null || nearNode(g, prev) === c || nearNode(g, next) === c) {
      // fallback: push the vertex out radially
      const a = Math.atan2(v[1] - c.y, v[0] - c.x);
      out.push([c.x + Math.cos(a) * c.R, c.y + Math.sin(a) * c.R]);
      continue;
    }
    const p0: P2 = [prev[0] + (v[0] - prev[0]) * t0, prev[1] + (v[1] - prev[1]) * t0];
    const p1: P2 = [v[0] + (next[0] - v[0]) * t1, v[1] + (next[1] - v[1]) * t1];
    const a0 = Math.atan2(p0[1] - c.y, p0[0] - c.x);
    const a1 = Math.atan2(p1[1] - c.y, p1[0] - c.x);
    // the block is CCW, so walking around a junction the arc runs clockwise
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.2));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      out.push([c.x + Math.cos(a) * c.R, c.y + Math.sin(a) * c.R]);
    }
  }
  if (!touched) return poly;
  const res: P2[] = [];
  for (const p of out) {
    const q = res[res.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) res.push(p);
  }
  if (res.length < 3 || polygonArea(res) < 20) return null;
  return res;
}
