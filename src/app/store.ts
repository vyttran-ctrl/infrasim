// App state. Network edits go through `applyEdit` so the live worker is told
// about every infrastructure change and vehicles reroute.

import { create } from 'zustand';
import type { MetricsSummary, RoadNetwork, Scenario, SimConfig } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/types';
import { sim } from './simBridge';

export type Tool =
  | 'inspect'
  | 'close'
  | 'lanes'
  | 'speed'
  | 'signal'
  | 'newRoad'
  | 'oneWay'
  | 'roundabout'
  | 'busLane'
  | 'bikeLane'
  | 'ped';

export type Selection = { kind: 'edge'; id: string } | { kind: 'node'; id: string } | null;
export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';
export type NetworkSource = 'grid' | 'waterloo' | 'osm';
export type HeatMode = 'utilization' | 'speed' | 'queue' | 'off';

interface AppState {
  network: RoadNetwork;
  /** The network as loaded, before any edits. The "before" side of Test my changes. */
  originalNetwork: RoadNetwork | null;
  source: NetworkSource;
  config: SimConfig;
  status: RunStatus;
  speed: number;
  tool: Tool;
  selection: Selection;
  hover: Selection;
  /** First node picked while drawing a new road. */
  pendingNode: string | null;
  heat: HeatMode;
  metrics: MetricsSummary | null;
  simTime: number;
  scenarios: Scenario[];
  /** Scenario ids ticked for comparison. */
  compareIds: string[];
  compareOpen: boolean;
  /** Edits made since the last load/reset; shown as a change list. */
  edits: string[];

  loadNetwork(net: RoadNetwork, source: NetworkSource): void;
  setConfig(patch: Partial<SimConfig>): void;
  start(): void;
  pause(): void;
  reset(): void;
  setSpeed(v: number): void;
  setTool(t: Tool): void;
  select(s: Selection): void;
  setHover(s: Selection): void;
  setPendingNode(id: string | null): void;
  setHeat(h: HeatMode): void;
  /** Replace the network with an edited copy and push it to the live sim. */
  applyEdit(next: RoadNetwork, label: string): void;
  saveScenario(name: string, note?: string): Scenario;
  removeScenario(id: string): void;
  restoreScenario(id: string): void;
  setScenarioResult(id: string, result: MetricsSummary): void;
  toggleCompare(id: string): void;
  setCompareOpen(open: boolean): void;
}

// Placeholder until the network module provides a real default; replaced in main.tsx.
const EMPTY: RoadNetwork = { id: 'empty', name: 'Empty', nodes: [], edges: [], signals: [], zones: [] };

const SCENARIO_KEY = 'infrasim.scenarios.v1';
function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    return raw ? (JSON.parse(raw) as Scenario[]) : [];
  } catch {
    return [];
  }
}
function persist(s: Scenario[]) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked; scenarios stay in memory */
  }
}

export const useApp = create<AppState>((set, get) => ({
  network: EMPTY,
  originalNetwork: null,
  source: 'grid',
  config: DEFAULT_CONFIG,
  status: 'idle',
  speed: 5,
  tool: 'inspect',
  selection: null,
  hover: null,
  pendingNode: null,
  heat: 'utilization',
  metrics: null,
  simTime: 0,
  scenarios: loadScenarios(),
  compareIds: [],
  compareOpen: false,
  edits: [],

  loadNetwork(net, source) {
    set({ network: net, originalNetwork: net, source, status: 'idle', selection: null, metrics: null, simTime: 0, edits: [], pendingNode: null });
    sim.load(net, get().config);
  },
  setConfig(patch) {
    const config = { ...get().config, ...patch };
    set({ config, status: 'idle', metrics: null, simTime: 0 });
    sim.load(get().network, config);
  },
  start() { sim.start(); set({ status: 'running' }); },
  pause() { sim.pause(); set({ status: 'paused' }); },
  reset() {
    sim.reset();
    set({ status: 'idle', metrics: null, simTime: 0 });
  },
  setSpeed(v) { sim.setSpeed(v); set({ speed: v }); },
  setTool(t) { set({ tool: t, pendingNode: null }); },
  select(s) { set({ selection: s }); },
  setHover(s) { set({ hover: s }); },
  setPendingNode(id) { set({ pendingNode: id }); },
  setHeat(h) { set({ heat: h }); },
  applyEdit(next, label) {
    set({ network: next, edits: [...get().edits, label] });
    sim.edit(next);
  },
  saveScenario(name, note) {
    const s: Scenario = {
      id: Math.random().toString(36).slice(2, 10),
      name,
      note,
      network: structuredClone(get().network),
      config: { ...get().config },
      createdAt: Date.now(),
    };
    const scenarios = [...get().scenarios, s];
    persist(scenarios);
    set({ scenarios, compareIds: [...get().compareIds, s.id] });
    return s;
  },
  removeScenario(id) {
    const scenarios = get().scenarios.filter((s) => s.id !== id);
    persist(scenarios);
    set({ scenarios, compareIds: get().compareIds.filter((c) => c !== id) });
  },
  restoreScenario(id) {
    const s = get().scenarios.find((x) => x.id === id);
    if (!s) return;
    set({ config: s.config });
    get().loadNetwork(structuredClone(s.network), get().source);
  },
  setScenarioResult(id, result) {
    const scenarios = get().scenarios.map((s) => (s.id === id ? { ...s, result } : s));
    persist(scenarios);
    set({ scenarios });
  },
  toggleCompare(id) {
    const c = get().compareIds;
    set({ compareIds: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
  },
  setCompareOpen(open) { set({ compareOpen: open }); },
}));

sim.onFrame((f) => {
  useApp.setState((s) => ({
    metrics: f.metrics,
    simTime: f.t,
    status: f.finished ? 'finished' : s.status,
  }));
});
