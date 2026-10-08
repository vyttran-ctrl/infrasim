// "Test my changes": run the original and the edited map off-screen with the
// same settings and seed, then compare a few headline numbers.

import { create } from 'zustand';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';
import { nodeLabel, setNodeKind } from '../net';
import { requestFocus } from '../render';
import { EDGE_STRIDE, type MetricsSummary, type RoadNetwork, type SimConfig } from '../sim/types';
import { commitEdit, flash, tryEdit } from './uiStore';

type TestStatus = 'idle' | 'running' | 'done' | 'error';

interface TestState {
  status: TestStatus;
  progress: number;
  before: MetricsSummary | null;
  after: MetricsSummary | null;
  config: SimConfig | null;
  /** Change labels the result is based on. */
  edits: string[];
  /** Results panel visible. */
  open: boolean;
  error: string | null;
  original: RoadNetwork | null;
  edited: RoadNetwork | null;
}

const IDLE: TestState = { status: 'idle', progress: 0, before: null, after: null, config: null, edits: [], open: false, error: null, original: null, edited: null };

export const useTest = create<TestState>(() => IDLE);

let runToken = 0;

export function clearTest() {
  runToken++;
  useTest.setState(IDLE);
}

export function closeResults() {
  useTest.setState({ open: false });
}

export async function runTest() {
  const app = useApp.getState();
  const original = app.originalNetwork;
  if (!original || app.edits.length === 0 || useTest.getState().status === 'running') return;
  const token = ++runToken;
  const config: SimConfig = { ...app.config };
  const edited: RoadNetwork = app.network;
  const edits = [...app.edits];
  const parts = [0, 0];
  const report = (i: number) => (f: number) => {
    parts[i] = f;
    if (token === runToken) useTest.setState({ progress: (parts[0] + parts[1]) / 2 });
  };
  app.select(null);
  useTest.setState({ ...IDLE, status: 'running', config, edits });
  try {
    const [before, after] = await Promise.all([
      sim.runHeadless(original, config, report(0)),
      sim.runHeadless(edited, config, report(1)),
    ]);
    if (token !== runToken) return;
    useTest.setState({ status: 'done', progress: 1, before, after, open: true, original, edited });
  } catch (e) {
    if (token !== runToken) return;
    useTest.setState({ status: 'error', error: e instanceof Error ? e.message : 'The test run failed.', open: true });
  }
}

// ---------------------------------------------------------------- example

/** The most central four-way signal (or any signal) in the network. */
export function centralSignal(net: RoadNetwork) {
  const signals = net.nodes.filter((n) => n.kind === 'signal');
  if (signals.length === 0) return null;
  const legs = (id: string) => net.edges.filter((e) => e.to === id).length;
  const fourWay = signals.filter((n) => legs(n.id) >= 4);
  const pool = fourWay.length ? fourWay : signals;
  const cx = net.nodes.reduce((t, n) => t + n.x, 0) / net.nodes.length;
  const cy = net.nodes.reduce((t, n) => t + n.y, 0) / net.nodes.length;
  return pool.reduce((best, n) => (Math.hypot(n.x - cx, n.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? n : best));
}

/** The traffic-light junction with the most cars waiting or arriving right now (from the live run). */
export function busiestSignal(net: RoadNetwork) {
  const f = sim.latest;
  if (!f || f.edgeStats.length !== net.edges.length * EDGE_STRIDE) return null;
  const load = new Map<string, number>();
  net.edges.forEach((e, i) => {
    const o = i * EDGE_STRIDE;
    load.set(e.to, (load.get(e.to) ?? 0) + f.edgeStats[o] + 2 * f.edgeStats[o + 2]);
  });
  let best: (typeof net.nodes)[number] | null = null;
  let bestLoad = 0;
  for (const n of net.nodes) {
    if (n.kind !== 'signal') continue;
    const l = load.get(n.id) ?? 0;
    if (l > bestLoad) { bestLoad = l; best = n; }
  }
  return bestLoad >= 6 ? best : null;
}

/** Turn the busiest junction into a roundabout and test it straight away. */
export function tryExample() {
  tryEdit(() => {
    const net = useApp.getState().network;
    const target = busiestSignal(net) ?? centralSignal(net);
    if (!target) {
      flash('This map has no traffic lights to swap for a roundabout.');
      return;
    }
    commitEdit(setNodeKind(net, target.id, 'roundabout'), `Made ${nodeLabel(net, target.id)} a roundabout`);
    requestFocus({ kind: 'node', id: target.id });
    void runTest();
  });
}
