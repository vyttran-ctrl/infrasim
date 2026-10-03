// Small synthetic networks for engine tests (independent of src/net builders).

import type { NetEdge, NetNode, RoadNetwork, SignalPlan, SimConfig, Zone } from './types';
import { DEFAULT_CONFIG } from './types';

interface EdgeOpts {
  lanes?: number;
  speed?: number;
  roadClass?: NetEdge['roadClass'];
  busLanes?: number;
  bikeLane?: boolean;
}

function dist(a: NetNode, b: NetNode) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

class Builder {
  nodes: NetNode[] = [];
  edges: NetEdge[] = [];
  signals: SignalPlan[] = [];
  zones: Zone[] = [];
  private byId = new Map<string, NetNode>();

  node(id: string, x: number, y: number, kind: NetNode['kind'] = 'priority', extra: Partial<NetNode> = {}) {
    const n: NetNode = { id, x, y, kind, ...extra };
    this.nodes.push(n);
    this.byId.set(id, n);
    return n;
  }

  oneWay(from: string, to: string, o: EdgeOpts = {}, id = `${from}_${to}`, pairId?: string): NetEdge {
    const a = this.byId.get(from)!, b = this.byId.get(to)!;
    const e: NetEdge = {
      id,
      from,
      to,
      name: `${from}-${to}`,
      lanes: o.lanes ?? 1,
      speedLimit: o.speed ?? 13.9,
      length: dist(a, b),
      closed: false,
      busLanes: o.busLanes ?? 0,
      bikeLane: o.bikeLane ?? false,
      pairId,
      roadClass: o.roadClass,
    };
    this.edges.push(e);
    return e;
  }

  twoWay(a: string, b: string, o: EdgeOpts = {}) {
    this.oneWay(a, b, o, `${a}_${b}`, `${b}_${a}`);
    this.oneWay(b, a, o, `${b}_${a}`, `${a}_${b}`);
  }

  build(id: string, od?: RoadNetwork['od']): RoadNetwork {
    return { id, name: id, nodes: this.nodes, edges: this.edges, signals: this.signals, zones: this.zones, od };
  }
}

export function testConfig(over: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, duration: 600, ...over };
}

/** Deep copy, so edits never mutate the original. */
export function cloneNet(n: RoadNetwork): RoadNetwork {
  return JSON.parse(JSON.stringify(n)) as RoadNetwork;
}

/**
 * Single signalised 4-arm crossroad C with boundary arms N/S/E/W.
 * Phases: "North/South" (N_C, S_C) then "East/West" (E_C, W_C).
 */
export function crossroad(o: { arm?: number; lanes?: number; nsGreen?: number; ewGreen?: number; kind?: NetNode['kind']; pedCrossing?: boolean } = {}): RoadNetwork {
  const arm = o.arm ?? 250;
  const b = new Builder();
  b.node('C', 0, 0, o.kind ?? 'signal', { pedCrossing: o.pedCrossing });
  b.node('N', 0, arm, 'boundary');
  b.node('S', 0, -arm, 'boundary');
  b.node('E', arm, 0, 'boundary');
  b.node('W', -arm, 0, 'boundary');
  for (const d of ['N', 'S', 'E', 'W']) b.twoWay(d, 'C', { lanes: o.lanes ?? 1 });
  if ((o.kind ?? 'signal') === 'signal') {
    b.signals.push({
      nodeId: 'C',
      offset: 0,
      pedPhase: 0,
      phases: [
        { name: 'North/South', greenEdges: ['N_C', 'S_C'], green: o.nsGreen ?? 25, yellow: 3, allRed: 2 },
        { name: 'East/West', greenEdges: ['E_C', 'W_C'], green: o.ewGreen ?? 25, yellow: 3, allRed: 2 },
      ],
    });
  }
  b.zones = ['N', 'S', 'E', 'W'].map((z) => ({ id: z, name: z, nodes: [z] }));
  return b.build('crossroad');
}

/**
 * One-way corridor W → M → E with `lanes` lanes and a signal at M that is
 * green for 30 s of every 50 s. All demand goes W → E.
 */
export function corridor(o: { lanes?: number; length?: number } = {}): RoadNetwork {
  const L = o.length ?? 300;
  const b = new Builder();
  b.node('W', -L, 0, 'boundary');
  b.node('M', 0, 0, 'signal');
  b.node('E', L, 0, 'boundary');
  b.oneWay('W', 'M', { lanes: o.lanes ?? 1 });
  b.oneWay('M', 'E', { lanes: o.lanes ?? 1 });
  b.signals.push({
    nodeId: 'M',
    offset: 0,
    pedPhase: 0,
    phases: [
      { name: 'Main', greenEdges: ['W_M'], green: 30, yellow: 3, allRed: 2 },
      { name: 'Side', greenEdges: [], green: 15, yellow: 0, allRed: 0 },
    ],
  });
  b.zones = [
    { id: 'W', name: 'West', nodes: ['W'] },
    { id: 'E', name: 'East', nodes: ['E'] },
  ];
  const od = { W: { E: 1 } };
  return b.build('corridor', { low: od, normal: od, rush: od, event: od });
}

/**
 * n × m grid of signalised junctions (spacing m apart) with a boundary node
 * at both ends of every row and column. Zones: North, South, East, West.
 */
export function grid(n = 3, m = 3, o: { spacing?: number; lanes?: number; signals?: boolean } = {}): RoadNetwork {
  const sp = o.spacing ?? 200;
  const b = new Builder();
  const id = (i: number, j: number) => `J${i}_${j}`;
  const kind = o.signals === false ? 'priority' : 'signal';
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) b.node(id(i, j), i * sp, j * sp, kind);
  const zones: Record<string, string[]> = { N: [], S: [], E: [], W: [] };
  for (let i = 0; i < n; i++) {
    b.node(`S${i}`, i * sp, -sp, 'boundary');
    b.node(`N${i}`, i * sp, m * sp, 'boundary');
    zones.S.push(`S${i}`);
    zones.N.push(`N${i}`);
  }
  for (let j = 0; j < m; j++) {
    b.node(`W${j}`, -sp, j * sp, 'boundary');
    b.node(`E${j}`, n * sp, j * sp, 'boundary');
    zones.W.push(`W${j}`);
    zones.E.push(`E${j}`);
  }
  const lanes = o.lanes ?? 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (i + 1 < n) b.twoWay(id(i, j), id(i + 1, j), { lanes });
      if (j + 1 < m) b.twoWay(id(i, j), id(i, j + 1), { lanes });
    }
    b.twoWay(`S${i}`, id(i, 0), { lanes });
    b.twoWay(id(i, m - 1), `N${i}`, { lanes });
  }
  for (let j = 0; j < m; j++) {
    b.twoWay(`W${j}`, id(0, j), { lanes });
    b.twoWay(id(n - 1, j), `E${j}`, { lanes });
  }
  if (kind === 'signal') {
    for (const node of b.nodes) {
      if (node.kind !== 'signal') continue;
      const inc = b.edges.filter((e) => e.to === node.id);
      const vert = inc.filter((e) => b.nodes.find((x) => x.id === e.from)!.x === node.x).map((e) => e.id);
      const horiz = inc.filter((e) => !vert.includes(e.id)).map((e) => e.id);
      b.signals.push({
        nodeId: node.id,
        offset: 0,
        pedPhase: 0,
        phases: [
          { name: 'North/South', greenEdges: vert, green: 25, yellow: 3, allRed: 2 },
          { name: 'East/West', greenEdges: horiz, green: 25, yellow: 3, allRed: 2 },
        ],
      });
    }
  }
  b.zones = Object.entries(zones).map(([z, nodes]) => ({ id: z, name: z, nodes }));
  return b.build(`grid${n}x${m}`);
}

/**
 * Two routes between W and E: a direct arterial A—B (400 m) and a detour
 * A—C—D—B to the north. A and B are priority junctions.
 */
export function parallelRoutes(): RoadNetwork {
  const b = new Builder();
  b.node('W', -300, 0, 'boundary');
  b.node('A', 0, 0, 'priority');
  b.node('B', 400, 0, 'priority');
  b.node('E', 700, 0, 'boundary');
  b.node('C', 0, 250, 'priority');
  b.node('D', 400, 250, 'priority');
  const art = { lanes: 2, speed: 16.7, roadClass: 'arterial' as const };
  b.twoWay('W', 'A', art);
  b.twoWay('A', 'B', art);
  b.twoWay('B', 'E', art);
  const loc = { lanes: 1, speed: 13.9, roadClass: 'local' as const };
  b.twoWay('A', 'C', loc);
  b.twoWay('C', 'D', loc);
  b.twoWay('D', 'B', loc);
  b.zones = [
    { id: 'W', name: 'West', nodes: ['W'] },
    { id: 'E', name: 'East', nodes: ['E'] },
  ];
  return b.build('parallel');
}

/** Two components with no connection between them. */
export function disconnected(): RoadNetwork {
  const b = new Builder();
  b.node('A', 0, 0, 'boundary');
  b.node('B', 200, 0, 'boundary');
  b.node('C', 0, 500, 'boundary');
  b.node('D', 200, 500, 'boundary');
  b.twoWay('A', 'B');
  b.twoWay('C', 'D');
  b.zones = [
    { id: 'south', name: 'South', nodes: ['A', 'B'] },
    { id: 'north', name: 'North', nodes: ['C', 'D'] },
  ];
  return b.build('disconnected');
}

/** A roundabout R with four boundary arms. */
export function roundabout(): RoadNetwork {
  const net = crossroad({ kind: 'roundabout' });
  net.id = 'roundabout';
  return net;
}
