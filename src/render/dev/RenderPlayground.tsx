// Dev-only harness: an inline network plus a fake animated SimFrame so the
// renderer can be exercised without the real worker. Not imported by the app.

import { useEffect, useState } from 'react';
import { useApp } from '../../app/store';
import { sim } from '../../app/simBridge';
import { LANE_WIDTH, edgePolyline, laneOffset, nodeIndex, pointAt, type Polyline } from '../../sim/geometry';
import { EDGE_STRIDE, VEH_STRIDE, type MetricsSummary, type NetEdge, type NetNode, type RoadNetwork, type SimFrame } from '../../sim/types';
import { SceneView, requestCameraReset, requestFocus } from '../index';

export function makeTestNetwork(): RoadNetwork {
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const S = 200;
  const cols = 4, rows = 3;
  const id = (c: number, r: number) => `n${c}_${r}`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kind = c === 2 && r === 1 ? 'roundabout' : (c + r) % 2 === 0 ? 'signal' : 'priority';
      nodes.push({ id: id(c, r), x: c * S, y: r * S, kind, pedCrossing: (c === 1 && r === 1) || (c === 0 && r === 0) });
    }
  }
  const two = (a: string, b: string, name: string, lanes: number, extra: Partial<NetEdge> = {}, pts?: [number, number][]) => {
    const A = nodes.find((n) => n.id === a)!, B = nodes.find((n) => n.id === b)!;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const e1: NetEdge = { id: `${a}-${b}`, from: a, to: b, name, lanes, speedLimit: 13.9, length: len, closed: false, busLanes: 0, bikeLane: false, pairId: `${b}-${a}`, points: pts, ...extra };
    const e2: NetEdge = { ...e1, id: `${b}-${a}`, from: b, to: a, pairId: `${a}-${b}`, points: pts ? [...pts].reverse() : undefined };
    edges.push(e1, e2);
    return [e1, e2];
  };
  const one = (a: string, b: string, name: string, lanes: number) => {
    const A = nodes.find((n) => n.id === a)!, B = nodes.find((n) => n.id === b)!;
    edges.push({ id: `${a}>${b}`, from: a, to: b, name, lanes, speedLimit: 11, length: Math.hypot(B.x - A.x, B.y - A.y), closed: false, busLanes: 0, bikeLane: false, roadClass: 'local' });
  };
  // east-west
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const art = r === 1;
      two(id(c, r), id(c + 1, r), art ? 'King Street' : r === 0 ? 'Erb Street' : 'Bridgeport Road', art ? 2 : 1, {
        roadClass: art ? 'arterial' : 'collector',
        busLanes: art && c === 0 ? 1 : 0,
        bikeLane: r === 2 && c === 1,
        lanes: art ? (c === 0 ? 3 : 2) : r === 2 && c === 1 ? 2 : 1,
      });
    }
  }
  // north-south
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++) {
      if (c === 3 && r === 0) {
        two(id(c, r), id(c, r + 1), 'Weber Street', 1, { roadClass: 'collector' }, [[S * 3 + 40, 60], [S * 3 + 55, 100], [S * 3 + 40, 140]]);
        continue;
      }
      if (c === 1) { one(id(c, r + 1), id(c, r), 'Albert St', 2); continue; }
      const [e1, e2] = two(id(c, r), id(c, r + 1), c === 0 ? 'Westmount Road' : 'Regina Street', c === 0 ? 2 : 1, { roadClass: c === 0 ? 'arterial' : 'local' });
      if (c === 2 && r === 0) { e1.closed = true; e2.closed = true; }
    }
  }
  // boundary stubs
  const stub = (from: string, dx: number, dy: number, name: string) => {
    const A = nodes.find((n) => n.id === from)!;
    const bid = `b_${from}_${dx}_${dy}`;
    nodes.push({ id: bid, x: A.x + dx, y: A.y + dy, kind: 'boundary' });
    two(from, bid, name, 1, { roadClass: 'collector' });
  };
  stub(id(0, 1), -160, 0, 'King Street');
  stub(id(3, 1), 160, 0, 'King Street');
  stub(id(0, 0), 0, -160, 'Westmount Road');
  stub(id(0, 2), 0, 160, 'Westmount Road');
  stub(id(2, 2), 0, 160, 'Regina Street');
  stub(id(2, 0), 0, -160, 'Regina Street');
  for (const e of edges) {
    if (!e.roadClass) e.roadClass = 'local';
    const nm = nodeIndex({ nodes } as RoadNetwork);
    e.length = edgePolyline(e, nm).length;
  }
  const zones = [
    { id: 'w', name: 'West', nodes: [`b_${id(0, 1)}_-160_0`] },
    { id: 'e', name: 'East', nodes: [`b_${id(3, 1)}_160_0`] },
    { id: 's', name: 'South', nodes: [`b_${id(0, 0)}_0_-160`, `b_${id(2, 0)}_0_-160`] },
    { id: 'n', name: 'North', nodes: [`b_${id(0, 2)}_0_160`, `b_${id(2, 2)}_0_160`] },
  ];
  return { id: 'playground-' + Math.random().toString(36).slice(2, 6), name: 'Playground', nodes, edges, signals: [], zones };
}

const EMPTY_METRICS = {} as MetricsSummary;

interface FakeVeh { id: number; edge: number; s: number; lane: number; v: number; kind: number; zone: number }

function startFakeSim(net: RoadNetwork, n: number): () => void {
  const nm = nodeIndex(net);
  const polys: Polyline[] = net.edges.map((e) => edgePolyline(e, nm));
  const outOf = new Map<string, number[]>();
  net.edges.forEach((e, i) => {
    if (e.closed) return;
    const l = outOf.get(e.from) ?? [];
    l.push(i);
    outOf.set(e.from, l);
  });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const open = net.edges.map((e, i) => (e.closed ? -1 : i)).filter((i) => i >= 0);
  const vehs: FakeVeh[] = [];
  for (let i = 0; i < n; i++) {
    const edge = open[Math.floor(rnd() * open.length)];
    const e = net.edges[edge];
    const kind = rnd() < 0.05 ? 1 : rnd() < 0.05 && e.bikeLane ? 2 : 0;
    vehs.push({ id: i, edge, s: rnd() * polys[edge].length, lane: Math.floor(rnd() * e.lanes), v: 6 + rnd() * 8, kind, zone: Math.floor(rnd() * net.zones.length) });
  }
  const buf = new Float32Array(n * VEH_STRIDE);
  let t = 0;
  const timer = setInterval(() => {
    const dt = 1 / 30;
    t += dt;
    for (let i = 0; i < vehs.length; i++) {
      const q = vehs[i];
      q.s += q.v * dt;
      if (q.s > polys[q.edge].length) {
        const nxt = outOf.get(net.edges[q.edge].to) ?? open;
        q.edge = nxt[Math.floor(rnd() * nxt.length)];
        q.s = 0;
        q.lane = Math.min(q.lane, net.edges[q.edge].lanes - 1);
      }
      const e = net.edges[q.edge];
      const p = pointAt(polys[q.edge], q.s, laneOffset(e, q.lane));
      const o = i * VEH_STRIDE;
      buf[o] = p.x; buf[o + 1] = p.y; buf[o + 2] = p.heading; buf[o + 3] = q.v; buf[o + 4] = q.kind; buf[o + 5] = q.id; buf[o + 6] = q.zone;
    }
    const E = net.edges.length;
    const stats = new Float32Array(E * EDGE_STRIDE);
    const aspects = new Uint8Array(E).fill(255);
    net.edges.forEach((e, i) => {
      const u = 0.5 + 0.5 * Math.sin(t * 0.3 + i * 1.7);
      stats[i * 4] = 3; stats[i * 4 + 1] = e.speedLimit * (1 - u * 0.8); stats[i * 4 + 2] = u * 8; stats[i * 4 + 3] = u;
      const to = nm.get(e.to)!;
      if (to.kind === 'signal') {
        const ns = Math.abs(polys[i].pts[polys[i].pts.length - 1][0] - polys[i].pts[polys[i].pts.length - 2][0]) < 1;
        const ph = (t % 30) / 30;
        const green = ns ? ph < 0.42 : ph >= 0.5 && ph < 0.92;
        const yellow = ns ? ph >= 0.42 && ph < 0.5 : ph >= 0.92;
        aspects[i] = green ? 0 : yellow ? 1 : 2;
      }
    });
    const pedActive = new Uint8Array(net.nodes.length);
    net.nodes.forEach((nd, i) => { if (nd.pedCrossing && t % 20 > 12) pedActive[i] = 1; });
    const frame: SimFrame = {
      t, running: true, finished: false, count: n, vehicles: buf.slice(), edgeStats: stats, aspects, pedActive, metrics: EMPTY_METRICS,
    };
    sim.latest = frame;
  }, 1000 / 30);
  return () => clearInterval(timer);
}

export function RenderPlayground() {
  const [count] = useState(() => Number(new URLSearchParams(location.search).get('n') ?? 1000));
  const [fps, setFps] = useState(0);
  const heat = useApp((s) => s.heat);
  const tool = useApp((s) => s.tool);
  const selection = useApp((s) => s.selection);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__render = { useApp, requestFocus, requestCameraReset };
    const net = makeTestNetwork();
    useApp.setState({ network: net, selection: null });
    const stop = startFakeSim(net, count);
    let frames = 0, last = performance.now(), raf = 0;
    const loop = () => {
      frames++;
      const now = performance.now();
      if (now - last > 1000) { setFps(Math.round((frames * 1000) / (now - last))); frames = 0; last = now; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { stop(); cancelAnimationFrame(raf); };
  }, [count]);

  const st = useApp.getState();
  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: 'system-ui', fontSize: 12 }}>
      <SceneView
        onPickEdge={(id) => {
          const s = useApp.getState();
          s.select({ kind: 'edge', id });
        }}
        onPickNode={(id) => {
          const s = useApp.getState();
          if (s.tool === 'newRoad') s.setPendingNode(id);
          else s.select({ kind: 'node', id });
        }}
        onPickNone={() => useApp.getState().select(null)}
      />
      <div id="hud" style={{ position: 'absolute', top: 8, left: 8, background: '#fffd', padding: 8, border: '1px solid #ccc', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>{fps} fps · {count} veh</span>
        {(['utilization', 'speed', 'queue', 'off'] as const).map((h) => (
          <button key={h} onClick={() => st.setHeat(h)} style={{ fontWeight: heat === h ? 700 : 400 }}>{h}</button>
        ))}
        <button onClick={() => st.setTool(tool === 'newRoad' ? 'inspect' : 'newRoad')}>{tool === 'newRoad' ? 'end road' : 'new road'}</button>
        <button onClick={() => requestCameraReset()}>reset cam</button>
        <button onClick={() => selection && requestFocus(selection)}>focus sel</button>
        <span>{selection ? `${selection.kind} ${selection.id}` : 'no selection'}</span>
        <span>{LANE_WIDTH} m lanes</span>
      </div>
    </div>
  );
}
