// The default demo city: 4×4 signalized grid with Waterloo-ish street names,
// slightly irregular so it reads like a town and not graph paper.
//
//            Westmount   King      Albert    Weber
//  Columbia    n00 ----- n01 ----- n02 ----- n03
//  University  n10 ----- n11 ***** n12 ----- n13      *** = key junction
//  Erb         n20 ----- n21 ----- n22 ----- n23          (arterial × arterial)
//  Bridgeport  n30 ----- n31 ----- n32 ----- n33
//
// Every outer street end runs to a boundary node (16 in total).

import type { NetEdge, NetNode, RoadNetwork, SignalPlan } from '../sim/types';
import { withLengths } from './edits';
import { defaultSignalPlan } from './signals';

type Cls = NonNullable<NetEdge['roadClass']>;
interface Street {
  key: string;
  name: string;
  lanes: number;
  speed: number; // m/s
  cls: Cls;
}

const KMH = 1 / 3.6;

// Rows north → south, columns west → east.
const ROWS: Street[] = [
  { key: 'col', name: 'Columbia St', lanes: 1, speed: 50 * KMH, cls: 'collector' },
  { key: 'uni', name: 'University Ave', lanes: 2, speed: 60 * KMH, cls: 'arterial' },
  { key: 'erb', name: 'Erb St', lanes: 1, speed: 50 * KMH, cls: 'collector' },
  { key: 'brp', name: 'Bridgeport Rd', lanes: 1, speed: 40 * KMH, cls: 'local' },
];
const COLS: Street[] = [
  { key: 'wmt', name: 'Westmount Rd', lanes: 1, speed: 50 * KMH, cls: 'collector' },
  { key: 'kng', name: 'King St', lanes: 2, speed: 60 * KMH, cls: 'arterial' },
  { key: 'alb', name: 'Albert St', lanes: 1, speed: 40 * KMH, cls: 'local' },
  { key: 'web', name: 'Weber St', lanes: 1, speed: 50 * KMH, cls: 'collector' },
];

const COL_X = [-370, -125, 120, 365];
const ROW_Y = [355, 115, -125, -360];
// Hand-picked jitter (dx, dy) per junction so blocks vary between ~215 and ~265 m.
const JITTER: [number, number][][] = [
  [[8, -6], [-4, 10], [14, 4], [-6, 18]],
  [[-10, 4], [0, 0], [6, -8], [12, 6]],
  [[4, 12], [-8, -6], [-14, 10], [6, -4]],
  [[-6, -10], [10, 6], [2, -14], [-12, 8]],
];
const STUB = 175;

// Gentle bends on a few blocks: [street key, block index] → offset of the midpoint (perpendicular, metres).
const BENDS: Record<string, number> = { erb_1: 14, erb_2: -10, alb_2: 16, brp_0: -12, wmt_2: 10, col_2: 8 };

const pos = (r: number, c: number): [number, number] => [COL_X[c] + JITTER[r][c][0], ROW_Y[r] + JITTER[r][c][1]];

function bendPoints(key: string, a: [number, number], b: [number, number]): [number, number][] | undefined {
  const off = BENDS[key];
  if (!off) return undefined;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const at = (u: number, k: number): [number, number] => [
    Math.round((a[0] + dx * u + nx * off * k) * 10) / 10,
    Math.round((a[1] + dy * u + ny * off * k) * 10) / 10,
  ];
  return [at(0.3, 0.8), at(0.5, 1), at(0.7, 0.8)];
}

export function buildGrid(): RoadNetwork {
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const jid = (r: number, c: number) => `n${r}${c}`;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const [x, y] = pos(r, c);
      nodes.push({ id: jid(r, c), x, y, kind: 'signal' });
    }
  }

  const twoWay = (s: Street, idx: number, from: string, to: string, pts: [number, number][] | undefined) => {
    const f = `${s.key}_${idx}`;
    const b = `${s.key}_${idx}_r`;
    const base = { name: s.name, lanes: s.lanes, speedLimit: Math.round(s.speed * 10) / 10, length: 0, closed: false, busLanes: 0, bikeLane: false, roadClass: s.cls };
    edges.push({ id: f, from, to, ...base, pairId: b, ...(pts ? { points: pts } : {}) });
    edges.push({ id: b, from: to, to: from, ...base, pairId: f, ...(pts ? { points: pts.slice().reverse() } : {}) });
  };

  const boundary = (id: string, x: number, y: number) => nodes.push({ id, x: Math.round(x), y: Math.round(y), kind: 'boundary' });

  // East–west streets.
  ROWS.forEach((s, r) => {
    const w = pos(r, 0);
    const e = pos(r, 3);
    boundary(`bW${r}`, w[0] - STUB, w[1] + (r === 2 ? 30 : r * 4 - 6));
    boundary(`bE${r}`, e[0] + STUB, e[1] + (r === 1 ? -20 : 6 - r * 3));
    twoWay(s, 0, `bW${r}`, jid(r, 0), undefined);
    for (let c = 0; c < 3; c++) {
      twoWay(s, c + 1, jid(r, c), jid(r, c + 1), bendPoints(`${s.key}_${c}`, pos(r, c), pos(r, c + 1)));
    }
    twoWay(s, 4, jid(r, 3), `bE${r}`, undefined);
  });

  // North–south streets.
  COLS.forEach((s, c) => {
    const n = pos(0, c);
    const so = pos(3, c);
    boundary(`bN${c}`, n[0] + (c === 3 ? 25 : c * 3 - 4), n[1] + STUB);
    boundary(`bS${c}`, so[0] + (c === 0 ? -22 : 5 - c * 2), so[1] - STUB);
    twoWay(s, 0, `bN${c}`, jid(0, c), undefined);
    for (let r = 0; r < 3; r++) {
      twoWay(s, r + 1, jid(r, c), jid(r + 1, c), bendPoints(`${s.key}_${r}`, pos(r, c), pos(r + 1, c)));
    }
    twoWay(s, 4, jid(3, c), `bS${c}`, undefined);
  });

  // Signalized junctions with a zebra / exclusive ped phase.
  for (const id of ['n21', 'n12']) {
    const n = nodes.find((x) => x.id === id)!;
    n.pedCrossing = true;
  }
  nodes.find((x) => x.id === 'n11')!.name = 'University Ave & King St';

  let net: RoadNetwork = {
    id: 'grid',
    name: 'Demo city (4×4 grid)',
    nodes,
    edges,
    signals: [],
    zones: [
      { id: 'residential', name: 'Residential', nodes: ['bW0', 'bW1', 'bW2', 'bW3', 'bN0', 'bN1'] },
      { id: 'campus', name: 'Campus', nodes: ['bN2', 'bN3', 'bE0'] },
      { id: 'downtown', name: 'Downtown', nodes: ['bE1', 'bE2', 'bE3', 'bS3'] },
      { id: 'industrial', name: 'Industrial', nodes: ['bS0', 'bS1', 'bS2'] },
    ],
    od: GRID_OD,
  };
  net = withLengths(net);

  const edgeById = new Map(net.edges.map((e) => [e.id, e]));
  const signals: SignalPlan[] = net.nodes
    .filter((n) => n.kind === 'signal')
    .map((n) => {
      const plan = defaultSignalPlan(net, n.id);
      // Arterials get the long green; local-only phases the short one.
      const phases = plan.phases.map((ph) => {
        const classes = new Set(ph.greenEdges.map((id) => edgeById.get(id)!.roadClass));
        const green = classes.has('arterial') ? 34 : classes.has('collector') ? 26 : 20;
        return { ...ph, green };
      });
      return { ...plan, phases };
    });
  return { ...net, signals };
}

const Z = ['residential', 'campus', 'downtown', 'industrial'] as const;
function od(m: number[][]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  Z.forEach((a, i) => {
    out[a] = {};
    Z.forEach((b, j) => {
      if (i !== j && m[i][j] > 0) out[a][b] = m[i][j];
    });
  });
  return out;
}

//                       to: res  campus downtown industrial
const GRID_OD: RoadNetwork['od'] = {
  low: od([
    [0, 1, 1, 1],
    [1, 0, 1, 1],
    [1, 1, 0, 1],
    [1, 1, 1, 0],
  ]),
  normal: od([
    [0, 1.2, 1.2, 1],
    [1.2, 0, 1, 0.8],
    [1.2, 1, 0, 1],
    [1, 0.8, 1, 0],
  ]),
  rush: od([
    [0, 6, 6, 3],
    [0.8, 0, 1, 0.4],
    [0.8, 1, 0, 0.6],
    [0.6, 0.4, 0.6, 0],
  ]),
  event: od([
    [0, 6, 1, 0.5],
    [1, 0, 1, 0.5],
    [1, 6, 0, 0.5],
    [0.5, 4, 0.5, 0],
  ]),
};
