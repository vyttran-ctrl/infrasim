// Main-thread side of the simulation worker. The renderer reads `latest`
// every animation frame (no React re-render); the store receives throttled
// metric updates through `onMetrics`.

import type { FromWorker, MetricsSummary, RoadNetwork, SimConfig, SimFrame, ToWorker } from '../sim/types';

type Listener<T> = (v: T) => void;

export class SimBridge {
  private worker: Worker;
  latest: SimFrame | null = null;
  private metricListeners = new Set<Listener<SimFrame>>();
  private jobs = new Map<string, { resolve: (s: MetricsSummary) => void; reject: (e: Error) => void; onProgress?: (f: number) => void }>();
  private lastMetricEmit = 0;

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case 'frame': {
        this.latest = msg.frame;
        const now = performance.now();
        // ~5 Hz to React; always emit state transitions
        if (now - this.lastMetricEmit > 200 || msg.frame.finished || !msg.frame.running) {
          this.lastMetricEmit = now;
          this.metricListeners.forEach((l) => l(msg.frame));
        }
        break;
      }
      case 'progress':
        this.jobs.get(msg.jobId)?.onProgress?.(msg.fraction);
        break;
      case 'headlessResult': {
        const job = this.jobs.get(msg.jobId);
        this.jobs.delete(msg.jobId);
        job?.resolve(msg.summary);
        break;
      }
      case 'error':
        console.error('[sim]', msg.message);
        this.jobs.forEach((j) => j.reject(new Error(msg.message)));
        this.jobs.clear();
        break;
    }
  }

  private post(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  load(network: RoadNetwork, config: SimConfig) { this.latest = null; this.post({ type: 'load', network, config }); }
  start() { this.post({ type: 'start' }); }
  pause() { this.post({ type: 'pause' }); }
  reset() { this.post({ type: 'reset' }); }
  setSpeed(value: number) { this.post({ type: 'speed', value }); }
  edit(network: RoadNetwork) { this.post({ type: 'edit', network }); }

  /** Runs a scenario to completion off-screen. Uses a dedicated worker so the live view keeps going. */
  runHeadless(network: RoadNetwork, config: SimConfig, onProgress?: (f: number) => void): Promise<MetricsSummary> {
    const jobId = Math.random().toString(36).slice(2);
    const w = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    return new Promise<MetricsSummary>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.fraction);
        else if (m.type === 'headlessResult') { w.terminate(); resolve(m.summary); }
        else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
      };
      w.postMessage({ type: 'runHeadless', jobId, network, config } satisfies ToWorker);
    });
  }

  onFrame(l: Listener<SimFrame>) {
    this.metricListeners.add(l);
    return () => this.metricListeners.delete(l);
  }
}

export const sim = new SimBridge();
