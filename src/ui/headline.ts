// Headline numbers and the one-sentence verdict for Test my changes.
// Pure functions so they can be unit tested.

import { nodeLabel } from '../net';
import type { MetricsSummary, RoadNetwork } from '../sim/types';
import { deltaPct, verdict } from './compareMetrics';

export interface Headline {
  key: string;
  label: string;
  unit: string;
  digits: 0 | 1;
  lowerBetter: boolean;
  get(m: MetricsSummary): number;
}

export const HEADLINES: Headline[] = [
  { key: 'tt', label: 'Average trip time', unit: 'min', digits: 1, lowerBetter: true, get: (m) => m.avgTravelTime / 60 },
  { key: 'delay', label: 'Average delay', unit: 'min', digits: 1, lowerBetter: true, get: (m) => m.avgDelay / 60 },
  { key: 'thr', label: 'Trips completed per hour', unit: 'trips/h', digits: 0, lowerBetter: false, get: (m) => m.throughput },
  { key: 'maxq', label: 'Longest queue', unit: 'cars', digits: 0, lowerBetter: true, get: (m) => m.maxQueue },
];

export type Tone = 'good' | 'bad' | 'same';

/** Percent change and its better/worse tone; changes under 2 % count as the same (run-to-run noise). */
export function change(h: Headline, before: MetricsSummary, after: MetricsSummary): { pct: number; tone: Tone } {
  const d = deltaPct(h.get(after), h.get(before));
  if (!Number.isFinite(d) || Math.round(Math.abs(d)) < 2) return { pct: Number.isFinite(d) ? d : 0, tone: 'same' };
  return { pct: d, tone: verdict(d, h.lowerBetter) };
}

/** One plain-English sentence about trip time and queues. */
export function verdictSentence(before: MetricsSummary, after: MetricsSummary): string {
  const tt = change(HEADLINES[0], before, after);
  const q = change(HEADLINES[3], before, after);
  const p = (v: number) => `${Math.round(Math.abs(v))}%`;
  const trips = tt.tone === 'good' ? `trips are ${p(tt.pct)} faster` : tt.tone === 'bad' ? `trips are ${p(tt.pct)} slower` : 'trip times are about the same';
  const queues =
    q.tone === 'good' ? `queues are ${p(q.pct)} shorter` : q.tone === 'bad' ? `the longest queue grew by ${p(q.pct)}` : 'queues are about the same';
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (tt.tone === 'same' && q.tone === 'same') return 'About the same: trip times and queues barely changed.';
  if (tt.tone !== 'same' && q.tone !== 'same' && tt.tone !== q.tone) {
    return tt.tone === 'good'
      ? 'Mixed: trips are faster but the longest queue grew.'
      : 'Mixed: queues are shorter but trips are slower.';
  }
  if (tt.tone === 'same' || q.tone === 'same') {
    const [moved, still] = tt.tone === 'same' ? [queues, trips] : [trips, queues];
    return `${tt.tone === 'bad' || q.tone === 'bad' ? 'Worse' : 'Better'}: ${moved}, and ${still}.`;
  }
  if (tt.tone === 'bad') return `Worse: ${trips} and ${queues}.`;
  return `${cap(trips)} and ${queues}.`;
}

// ---------------------------------------------------------------- local effect
// One junction in a 100-junction city barely moves city-wide averages, so the
// results also show what happened right where the change was made.

export interface ChangedArea {
  label: string;
  /** Roads leading into the junctions that were changed. */
  edgeIds: string[];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changedArea(original: RoadNetwork, edited: RoadNetwork): ChangedArea | null {
  const touched = new Set<string>();
  const before = new Map(original.edges.map((e) => [e.id, e]));
  const after = new Map(edited.edges.map((e) => [e.id, e]));
  const streets = new Set<string>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id);
    if (sameJson(a, b)) continue;
    const e = (b ?? a)!;
    touched.add(e.to);
    touched.add(e.from);
    streets.add(e.name);
  }
  const nodesBefore = new Map(original.nodes.map((n) => [n.id, n]));
  const nodesChanged: string[] = [];
  for (const n of edited.nodes) {
    if (!sameJson(n, nodesBefore.get(n.id))) { touched.add(n.id); nodesChanged.push(n.id); }
  }
  const plans = new Map(original.signals.map((s) => [s.nodeId, s]));
  for (const s of edited.signals) {
    if (!sameJson(s, plans.get(s.nodeId))) { touched.add(s.nodeId); nodesChanged.push(s.nodeId); }
  }
  for (const s of original.signals) if (!edited.signals.some((x) => x.nodeId === s.nodeId)) { touched.add(s.nodeId); nodesChanged.push(s.nodeId); }
  if (touched.size === 0) return null;

  const isJunction = (id: string) => edited.nodes.find((n) => n.id === id)?.kind !== 'boundary';
  const edgeIds = edited.edges.filter((e) => touched.has(e.to) && isJunction(e.to)).map((e) => e.id);
  if (edgeIds.length === 0) return null;
  const uniqueNodes = [...new Set(nodesChanged)];
  const label =
    uniqueNodes.length === 1 && streets.size === 0
      ? nodeLabel(original.nodes.some((n) => n.id === uniqueNodes[0]) ? original : edited, uniqueNodes[0])
      : streets.size === 1 && uniqueNodes.length === 0
        ? [...streets][0]
        : 'the places you changed';
  return { label, edgeIds };
}

export interface LocalStats {
  cars: number;
  /** entry-weighted seconds lost per car at those junctions */
  wait: number;
  maxQueue: number;
}

export function localStats(m: MetricsSummary, edgeIds: string[]): LocalStats {
  const ids = new Set(edgeIds);
  let cars = 0, waitSum = 0, maxQueue = 0;
  for (const e of m.edges ?? []) {
    if (!ids.has(e.id)) continue;
    cars += e.entries;
    waitSum += e.delay * e.entries;
    maxQueue = Math.max(maxQueue, e.maxQueue);
  }
  return { cars, wait: cars ? waitSum / cars : 0, maxQueue };
}

export interface LocalHeadline {
  key: string;
  label: string;
  unit: string;
  digits: 0 | 1;
  lowerBetter: boolean;
  get(s: LocalStats): number;
}

export const LOCAL_HEADLINES: LocalHeadline[] = [
  { key: 'wait', label: 'Wait at the junction', unit: 's per car', digits: 0, lowerBetter: true, get: (s) => s.wait },
  { key: 'cars', label: 'Cars that came through', unit: 'cars', digits: 0, lowerBetter: false, get: (s) => s.cars },
  { key: 'q', label: 'Longest queue here', unit: 'cars', digits: 0, lowerBetter: true, get: (s) => s.maxQueue },
];

export function localChange(h: LocalHeadline, before: LocalStats, after: LocalStats): { pct: number; tone: Tone } {
  const d = deltaPct(h.get(after), h.get(before));
  if (!Number.isFinite(d) || Math.round(Math.abs(d)) < 5) return { pct: Number.isFinite(d) ? d : 0, tone: 'same' };
  return { pct: d, tone: verdict(d, h.lowerBetter) };
}

/** e.g. "At King St & Erb St, each car waits 35% less (18 s to 12 s)." */
export function localSentence(area: ChangedArea, before: LocalStats, after: LocalStats): string {
  const c = localChange(LOCAL_HEADLINES[0], before, after);
  const s = (v: number) => `${Math.round(v)} s`;
  const where = area.label === 'the places you changed' ? 'Where you made changes' : `At ${area.label}`;
  if (before.cars === 0 && after.cars === 0) return `${where}, no cars came through in either run.`;
  if (c.tone === 'same') return `${where}, the wait is about the same (${s(before.wait)} to ${s(after.wait)} per car).`;
  const p = Math.round(Math.abs(c.pct));
  return c.tone === 'good'
    ? `${where}, each car waits ${p}% less (${s(before.wait)} to ${s(after.wait)}).`
    : `${where}, each car waits ${p}% longer (${s(before.wait)} to ${s(after.wait)}).`;
}
