/// <reference lib="webworker" />
// Web Worker entry: owns one Simulation, runs it in (scaled) real time and
// posts frames ~30×/s. `runHeadless` runs a whole scenario as fast as possible.

import type { FromWorker, RoadNetwork, SimConfig, SimFrame, ToWorker } from './types';
import { Simulation } from './engine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const FRAME_MS = 1000 / 30;
/** never simulate more than this many steps per tick (keeps the worker responsive) */
const MAX_STEPS_PER_TICK = 400;

let sim: Simulation | null = null;
let network: RoadNetwork | null = null;
let config: SimConfig | null = null;
let running = false;
let speed = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTick = 0;
let acc = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function postFrame() {
  if (!sim) return;
  const frame: SimFrame = sim.frame(running);
  post({ type: 'frame', frame }, [frame.vehicles.buffer, frame.edgeStats.buffer, frame.aspects.buffer, frame.pedActive.buffer]);
}

function stopLoop() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function tick() {
  timer = null;
  if (!sim || !running) return;
  try {
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    acc += elapsed * speed;
    const dt = sim.dt;
    let steps = Math.floor(acc / dt + 1e-9);
    if (steps > MAX_STEPS_PER_TICK) {
      steps = MAX_STEPS_PER_TICK;
      acc = 0;
    } else acc -= steps * dt;
    for (let i = 0; i < steps && !sim.finished; i++) sim.step();
    if (sim.finished) running = false;
    postFrame();
  } catch (err) {
    running = false;
    postError(err);
    return;
  }
  if (running) timer = setTimeout(tick, FRAME_MS);
}

function startLoop() {
  stopLoop();
  lastTick = performance.now();
  acc = 0;
  timer = setTimeout(tick, FRAME_MS);
}

function postError(err: unknown) {
  post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
}

function handle(msg: ToWorker) {
  switch (msg.type) {
    case 'load':
      stopLoop();
      network = msg.network;
      config = msg.config;
      running = false;
      sim = new Simulation(network, config);
      postFrame();
      break;
    case 'start':
      if (!sim || sim.finished) {
        postFrame();
        break;
      }
      running = true;
      startLoop();
      break;
    case 'pause':
      running = false;
      stopLoop();
      postFrame();
      break;
    case 'reset':
      stopLoop();
      running = false;
      if (network && config) sim = new Simulation(network, config);
      postFrame();
      break;
    case 'speed':
      speed = Math.max(0.01, Number(msg.value) || 1);
      break;
    case 'edit':
      network = msg.network;
      if (sim) {
        sim.applyEdit(msg.network);
        postFrame();
      }
      break;
    case 'runHeadless': {
      const h = new Simulation(msg.network, msg.config);
      let last = -1;
      const summary = h.runToEnd((f) => {
        const pct = Math.floor(f * 50);
        if (pct !== last) {
          last = pct;
          post({ type: 'progress', jobId: msg.jobId, fraction: f });
        }
      });
      post({ type: 'progress', jobId: msg.jobId, fraction: 1 });
      post({ type: 'headlessResult', jobId: msg.jobId, summary });
      break;
    }
  }
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    handle(e.data);
  } catch (err) {
    postError(err);
  }
};
