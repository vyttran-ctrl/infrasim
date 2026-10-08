import type { MetricsSummary } from '../sim/types';
import { toKmh } from './format';

export interface CompareMetric {
  key: string;
  label: string;
  unit: string;
  digits: 0 | 1 | 2;
  /** true: a lower value is an improvement */
  lowerBetter: boolean;
  get(m: MetricsSummary): number;
  /** shown as a bar chart below the table */
  chart?: boolean;
}

export const COMPARE_METRICS: CompareMetric[] = [
  { key: 'tt', label: 'Average trip time', unit: 'min', digits: 2, lowerBetter: true, get: (m) => m.avgTravelTime / 60, chart: true },
  { key: 'delay', label: 'Average delay', unit: 'min', digits: 2, lowerBetter: true, get: (m) => m.avgDelay / 60, chart: true },
  { key: 'idelay', label: 'Waiting at junctions', unit: 's per trip', digits: 1, lowerBetter: true, get: (m) => m.intersectionDelay },
  { key: 'thr', label: 'Trips completed per hour', unit: 'trips/h', digits: 0, lowerBetter: false, get: (m) => m.throughput, chart: true },
  { key: 'maxq', label: 'Longest queue', unit: 'cars', digits: 0, lowerBetter: true, get: (m) => m.maxQueue, chart: true },
  { key: 'avgq', label: 'Average queue', unit: 'cars', digits: 1, lowerBetter: true, get: (m) => m.avgQueue },
  { key: 'spd', label: 'Average speed', unit: 'km/h', digits: 1, lowerBetter: false, get: (m) => toKmh(m.avgSpeed) },
  { key: 'done', label: 'Trips completed', unit: 'trips', digits: 0, lowerBetter: false, get: (m) => m.completedTrips },
  { key: 'rr', label: 'Cars that changed route', unit: 'cars', digits: 0, lowerBetter: true, get: (m) => m.reroutes },
  { key: 'co2', label: 'CO₂ emitted', unit: 'kg', digits: 1, lowerBetter: true, get: (m) => m.co2, chart: true },
];

/** Percentage change vs baseline, or NaN when the baseline is zero. */
export function deltaPct(value: number, base: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return NaN;
  return ((value - base) / Math.abs(base)) * 100;
}

/** 'good' | 'bad' | 'same' under a 0.5 % dead band. */
export function verdict(delta: number, lowerBetter: boolean): 'good' | 'bad' | 'same' {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return 'same';
  return delta < 0 === lowerBetter ? 'good' : 'bad';
}
