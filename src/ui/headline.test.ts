import { describe, expect, it } from 'vitest';
import type { MetricsSummary } from '../sim/types';
import { change, HEADLINES, verdictSentence } from './headline';

const m = (avgTravelTime: number, maxQueue: number): MetricsSummary =>
  ({ avgTravelTime, maxQueue, avgDelay: 0, throughput: 1000 }) as MetricsSummary;

describe('verdictSentence', () => {
  it('reports two improvements', () => {
    expect(verdictSentence(m(600, 100), m(474, 59))).toBe('Trips are 21% faster and queues are 41% shorter.');
  });
  it('flags a mixed result', () => {
    expect(verdictSentence(m(600, 50), m(500, 80))).toBe('Mixed: trips are faster but the longest queue grew.');
  });
  it('treats tiny changes as the same', () => {
    expect(verdictSentence(m(600, 60), m(603, 60))).toBe('About the same: trip times and queues barely changed.');
  });
  it('names the one thing that moved', () => {
    expect(verdictSentence(m(600, 60), m(600, 90))).toBe('Worse: the longest queue grew by 50%, and trip times are about the same.');
  });
});

describe('change', () => {
  it('marks higher throughput as better', () => {
    const thr = HEADLINES.find((h) => h.key === 'thr')!;
    const a = { ...m(1, 1), throughput: 1000 };
    const b = { ...m(1, 1), throughput: 1100 };
    expect(change(thr, a, b).tone).toBe('good');
  });
});
