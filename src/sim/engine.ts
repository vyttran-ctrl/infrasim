// The simulation core. Pure TypeScript, no DOM — runs in the worker and in node tests.
//
// Per step (fixed dt):
//   signals & pedestrians → release due trips into origin queues → prepass
//   (box occupancy, per-lane stop-line candidates) → junction permissions →
//   IDM accelerations → integrate → edge/ring transitions → lane changes →
//   spawning → statistics.
// Every pass is O(vehicles + lanes); lanes keep their vehicles sorted front → back.

import type { MetricsSummary, RoadNetwork, SimConfig, SimFrame, Zone } from './types';
import { Aspect, EDGE_STRIDE, VEH_STRIDE, VehicleKind } from './types';
import { STOP_LINE_SETBACK, edgePolyline, junctionLayout, laneOffset, nodeIndex, pointAt, type Polyline } from './geometry';
import { KIND_PARAMS, freeFlowSpeed, idmAccel, laneAllowed, laneType, usableLanes, LANE_BUS } from './idm';
import { buildGraph, shortestPath, type RouteGraph } from './graph';
import { compileSignal, signalState, aspectFor } from './signals';
import { generateTrips, resolveZones, type Trip } from './demand';
import { Rng } from './rng';
import { Veh, type EdgeAccum, type EdgeRT, type LaneRT, type NodeRT } from './runtime';
import { evaluateNode, ringAngle, ringArc, RING_R, RING_V, type JunctionCtx } from './junction';
import { laneChangePass, type LCContext } from './lanechange';
import { MetricsCollector, SERIES_INTERVAL, fuelRate } from './metrics';

/** pedestrian groups per second at an unsignalised crossing */
export const PED_RATE = 60 / 3600;
/** seconds a pedestrian group blocks the crossing */
export const PED_CROSS = 6;
/** approach speed into a roundabout, m/s */
const ROUNDABOUT_APPROACH_V = 8;
const LOOKAHEAD = 150;
const OBS_SPEED_INTERVAL = 10;
const REROUTE_INTERVAL = 60;
const REROUTE_PROB = 0.1;

interface Pending {
  trip: Trip;
  route: number[] | null;
  kind: VehicleKind;
  ver: number;
}

const ROAD_CLASS_SCORE: Record<string, number> = { arterial: 3, collector: 2, local: 1 };

function newAccum(speed: number): EdgeAccum {
  return { obsSpeed: speed, utilFast: 0, utilSlow: 0, queueSlow: 0, utilTime: 0, queueTime: 0, vehTime: 0, entries: 0, exits: 0, delaySum: 0, queueMax: 0 };
}

function headingOf(poly: Polyline, end: boolean): number {
  const p = poly.pts;
  if (p.length < 2) return 0;
  const [a, b] = end ? [p[p.length - 2], p[p.length - 1]] : [p[0], p[1]];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export class Simulation implements JunctionCtx, LCContext {
  readonly config: SimConfig;
  network!: RoadNetwork;
  readonly trips: Trip[];
  readonly zones: Zone[];
  t = 0;
  stepCount = 0;
  finished = false;
  dt: number;

  nodes: NodeRT[] = [];
  edges: EdgeRT[] = [];
  graph!: RouteGraph;
  nodeIdx = new Map<string, number>();
  edgeIdx = new Map<string, number>();
  aspects = new Uint8Array(0);
  pedActive = new Uint8Array(0);
  active: Veh[] = [];
  readonly metrics = new MetricsCollector();

  private tripPtr = 0;
  private queues = new Map<string, Pending[]>();
  private netVer = 0;
  private nextId = 0;
  private rerouteRng: Rng;
  private pedRng = new Map<string, Rng>();
  private accumById = new Map<string, EdgeAccum>();
  private nextSeries = SERIES_INTERVAL;

  constructor(network: RoadNetwork, config: SimConfig) {
    this.config = { ...config };
    this.dt = config.dt > 0 ? config.dt : 0.2;
    this.zones = resolveZones(network);
    this.trips = generateTrips(network, this.config);
    this.rerouteRng = Rng.stream(config.seed, 'reroute');
    this.build(network);
    this.updateSignals();
    this.updatePeds();
  }

  // ------------------------------------------------------------ build / edit

  private build(net: RoadNetwork) {
    this.network = net;
    const byId = nodeIndex(net);
    this.nodeIdx = new Map(net.nodes.map((n, i) => [n.id, i]));
    this.edgeIdx = new Map(net.edges.map((e, i) => [e.id, i]));
    this.graph = buildGraph(net);
    const layout = junctionLayout(net);

    this.edges = net.edges.map((def, idx): EdgeRT => {
      const valid = byId.has(def.from) && byId.has(def.to);
      const poly: Polyline = valid ? edgePolyline(def, byId) : { pts: [[0, 0], [0, 0]], cum: [0, 0], length: 0 };
      const length = poly.length > 1 ? poly.length : Math.max(1, def.length || 1);
      const setback = layout.stopSetback[idx] ?? STOP_LINE_SETBACK;
      const stopLine = length > 2 * setback ? length - setback : length * 0.5;
      const lanes: LaneRT[] = [];
      for (let i = 0; i < Math.max(1, def.lanes); i++) lanes.push({ type: laneType(def, i), vehs: [], cand: null });
      let stats = this.accumById.get(def.id);
      if (!stats) {
        stats = newAccum(def.speedLimit);
        this.accumById.set(def.id, stats);
      }
      const toNode = byId.get(def.to);
      return {
        idx,
        id: def.id,
        def,
        from: valid ? this.nodeIdx.get(def.from)! : -1,
        to: valid ? this.nodeIdx.get(def.to)! : -1,
        poly,
        length,
        stopLine,
        lanes,
        usable: [usableLanes(def, VehicleKind.Car), usableLanes(def, VehicleKind.Bus), usableLanes(def, VehicleKind.Bike)],
        blockedEst: false,
        headingEnd: headingOf(poly, true),
        headingStart: headingOf(poly, false),
        rank: (ROAD_CLASS_SCORE[def.roadClass ?? ''] ?? 0) * 1000 + Math.round(def.speedLimit),
        isApproach: !!toNode && toNode.kind !== 'boundary',
        // saturation flow scales the time headway (1800 veh/h/lane = model default)
        tFactor: def.capacity && def.capacity > 0 ? Math.max(0.5, Math.min(3, 1800 / def.capacity)) : 1,
        count: 0,
        sumSpeed: 0,
        queue: 0,
        util: 0,
        stats,
      };
    });

    const plans = new Map(net.signals.map((p) => [p.nodeId, p]));
    this.nodes = net.nodes.map(
      (def, idx): NodeRT => ({
        idx,
        id: def.id,
        def,
        control: 'free',
        incoming: [],
        outgoing: [],
        major: [],
        box: [],
        signal: null,
        ring: [],
        ringR: layout.ringRadius[idx] || RING_R,
        pedUntil: -1,
        pedNext: -1,
        pedActive: false,
      }),
    );
    for (const e of this.edges) {
      if (e.from < 0) continue;
      this.nodes[e.to].incoming.push(e.idx);
      this.nodes[e.from].outgoing.push(e.idx);
    }
    for (const n of this.nodes) {
      const neighbours = new Set<number>();
      for (const ei of n.incoming) neighbours.add(this.edges[ei].from);
      for (const ei of n.outgoing) neighbours.add(this.edges[ei].to);
      const kind = n.def.kind;
      if (kind === 'signal') n.signal = compileSignal(plans.get(n.id), this.edgeIdx, n.incoming);
      if (n.signal) n.control = 'signal';
      else if (kind === 'roundabout') n.control = 'roundabout';
      else if (kind === 'boundary') n.control = 'free';
      else n.control = neighbours.size >= 3 && n.incoming.length >= 2 ? 'priority' : 'free';
      const ranks = n.incoming.map((ei) => this.edges[ei].rank);
      const maxRank = Math.max(-Infinity, ...ranks);
      const allEqual = ranks.every((r) => r === maxRank);
      n.major = ranks.map((r) => !allEqual && r === maxRank);
    }
    this.aspects = new Uint8Array(this.edges.length).fill(Aspect.NoSignal);
    this.pedActive = new Uint8Array(this.nodes.length);
  }

  /** Live infrastructure change. Vehicles whose remaining route became invalid reroute. */
  applyEdit(net: RoadNetwork): void {
    const oldEdges = this.edges;
    const oldNodes = this.nodes;
    this.build(net);
    for (const on of oldNodes) {
      const ni = this.nodeIdx.get(on.id);
      if (ni === undefined) continue;
      this.nodes[ni].pedUntil = on.pedUntil;
      this.nodes[ni].pedNext = on.pedNext;
    }
    const remap = oldEdges.map((e) => this.edgeIdx.get(e.id) ?? -1);
    const survivors: Veh[] = [];
    for (const v of this.active) {
      v.route = v.route.map((r) => (r >= 0 ? remap[r] : -1));
      v.boxNode = v.boxEdge = v.boxIn = -1;
      if (v.edge >= 0) {
        const ne = remap[v.edge];
        if (ne < 0 || this.edges[ne].from < 0) continue; // its road was removed
        const e = this.edges[ne];
        v.edge = ne;
        v.lane = Math.min(v.lane, e.lanes.length - 1);
        v.s = Math.min(v.s, e.length);
      } else {
        const ni = this.nodeIdx.get(oldNodes[v.ringNode].id);
        if (ni === undefined) continue;
        v.ringNode = ni;
        this.nodes[ni].ring.push(v);
      }
      survivors.push(v);
    }
    this.active = survivors;
    survivors.forEach((v, i) => (v.slot = i));
    for (const v of survivors) if (v.edge >= 0) this.edges[v.edge].lanes[v.lane].vehs.push(v);
    for (const e of this.edges) for (const l of e.lanes) l.vehs.sort((a, b) => b.s - a.s || a.id - b.id);
    for (const v of survivors) {
      if (!v.doomed && this.needsReroute(v)) this.rerouteFromCurrent(v);
    }
    this.netVer++;
    this.updateSignals();
    this.updatePeds();
  }

  edgeUsable(ei: number, kind: VehicleKind): boolean {
    if (ei < 0) return false;
    const e = this.edges[ei];
    return e.from >= 0 && !e.def.closed && e.usable[kind] > 0;
  }

  private needsReroute(v: Veh): boolean {
    let at = v.edge >= 0 ? this.edges[v.edge].to : v.ringNode;
    for (let i = v.ri + 1; i < v.route.length; i++) {
      const r = v.route[i];
      if (!this.edgeUsable(r, v.kind)) return true;
      const e = this.edges[r];
      if (e.from !== at) return true;
      at = e.to;
    }
    return at !== v.destNode;
  }

  private routeCost = (kind: VehicleKind) => {
    const v0 = KIND_PARAMS[kind].v0;
    return (ei: number) => {
      const e = this.edges[ei];
      if (e.from < 0 || e.def.closed || e.usable[kind] === 0) return Infinity;
      return e.length / Math.max(1, Math.min(e.def.speedLimit, v0, e.stats.obsSpeed));
    };
  };

  findPath(from: number, to: number, kind: VehicleKind): number[] | null {
    const p = shortestPath(this.graph, from, to, this.routeCost(kind), Math.min(this.graph.maxSpeed, KIND_PARAMS[kind].v0));
    return p && p.length > 0 ? p : null;
  }

  private rerouteFromCurrent(v: Veh) {
    const start = v.edge >= 0 ? this.edges[v.edge].to : v.ringNode;
    const keep = v.route.slice(0, v.ri + 1);
    const path = start === v.destNode ? [] : this.findPath(start, v.destNode, v.kind);
    if (path) {
      v.route = keep.concat(path);
      this.metrics.reroutes++;
    } else {
      v.route = keep;
      v.doomed = true;
      this.metrics.unroutable++;
    }
    if (v.edge < 0) this.fixRingArc(v);
  }

  private fixRingArc(v: Veh) {
    const nx = this.nextEdge(v);
    if (nx >= 0) v.ringLen = ringArc(v.ringTheta0, this.edges[nx].headingStart, v.ringR);
    else v.ringLen = 0;
  }

  // ------------------------------------------------------------ helpers (ctx)

  nextEdge(v: Veh): number {
    return v.ri + 1 < v.route.length ? v.route[v.ri + 1] : -1;
  }

  targetLane(ei: number, v: Veh): number {
    const e = this.edges[ei];
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < e.lanes.length; i++) {
      const l = e.lanes[i];
      if (!laneAllowed(l.type, v.kind)) continue;
      const last = l.vehs[l.vehs.length - 1];
      let score = Math.min(200, last ? last.s - last.len : 200);
      if (v.kind === VehicleKind.Bus && l.type === LANE_BUS) score += 20;
      score -= 0.01 * Math.abs(i - v.lane);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) best = Math.min(v.lane, e.lanes.length - 1);
    return best;
  }

  downstreamBlocked(ei: number, v: Veh): boolean {
    const l = this.edges[ei].lanes[this.targetLane(ei, v)];
    const last = l.vehs[l.vehs.length - 1];
    return !!last && last.s - last.len < v.len + 1.5 && last.v < 2;
  }

  private desired(v: Veh, e: EdgeRT): number {
    let v0 = Math.min(e.def.speedLimit * v.speedFactor, KIND_PARAMS[v.kind].v0);
    if (e.to >= 0 && this.nodes[e.to].control === 'roundabout' && e.length - v.s < 40 && this.nextEdge(v) >= 0) v0 = Math.min(v0, ROUNDABOUT_APPROACH_V);
    return Math.max(1, v0);
  }

  /** Gap/approach-rate to whatever lies beyond the end of the lane (next edge's last vehicle). */
  private lookahead(v: Veh, e: EdgeRT, out: { gap: number; dv: number }) {
    out.gap = Infinity;
    out.dv = 0;
    if (e.length - v.s > LOOKAHEAD) return;
    const nx = this.nextEdge(v);
    if (nx < 0 || this.nodes[e.to].control === 'roundabout') return;
    const l = this.edges[nx].lanes[this.targetLane(nx, v)];
    const last = l.vehs[l.vehs.length - 1];
    if (!last) return;
    out.gap = e.length - v.s + last.s - last.len;
    out.dv = v.v - last.v;
  }

  private tmp = { gap: Infinity, dv: 0 };

  accelWith(v: Veh, e: EdgeRT, leader: Veh | null): number {
    const v0 = this.desired(v, e);
    let gap = Infinity, dv = 0;
    if (leader) {
      gap = leader.s - leader.len - v.s;
      dv = v.v - leader.v;
    } else {
      const blocked = v.s < e.stopLine && e.blockedEst;
      if (!blocked) {
        this.lookahead(v, e, this.tmp);
        gap = this.tmp.gap;
        dv = this.tmp.dv;
      } else {
        gap = e.stopLine - v.s;
        dv = v.v;
      }
    }
    return idmAccel(v.v, v0, gap, dv, v.a, v.b, v.s0, v.T * e.tFactor);
  }

  // ------------------------------------------------------------ step

  step(): void {
    if (this.finished) return;
    const dt = this.dt;
    this.stepCount++;
    this.t = this.stepCount * dt; // no float drift
    this.updateSignals();
    this.updatePeds();
    this.releaseTrips();
    this.prepass();
    for (const n of this.nodes) evaluateNode(this, n);
    this.accelerations();
    this.integrate(dt);
    this.transitions();
    this.updateRings(dt);
    laneChangePass(this);
    this.spawn();
    this.collectStats(dt);
    if (this.stepCount % Math.max(1, Math.round(OBS_SPEED_INTERVAL / dt)) === 0) this.updateObservedSpeeds();
    if (this.stepCount % Math.max(1, Math.round(REROUTE_INTERVAL / dt)) === 0) this.periodicReroute();
    if (this.t + 1e-9 >= this.nextSeries) {
      this.nextSeries += SERIES_INTERVAL;
      this.sampleSeries();
    }
    if (this.t + 1e-9 >= this.config.duration) this.finished = true;
  }

  /** Advance by `seconds` of simulated time (or until finished). */
  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n && !this.finished; i++) this.step();
  }

  runToEnd(onProgress?: (f: number) => void): MetricsSummary {
    const total = Math.max(1, Math.round(this.config.duration / this.dt));
    const every = Math.max(1, Math.floor(total / 50));
    let i = 0;
    while (!this.finished) {
      this.step();
      i++;
      if (onProgress && i % every === 0) onProgress(Math.min(1, i / total));
    }
    return this.summary();
  }

  private updateSignals() {
    for (const n of this.nodes) {
      if (n.control === 'signal' && n.signal) {
        const st = signalState(n.signal, this.t);
        for (const ei of n.incoming) this.aspects[ei] = aspectFor(n.signal, st, ei);
        n.pedActive = st.stage === 'ped';
        this.pedActive[n.idx] = n.pedActive ? 1 : 0;
      }
    }
  }

  private updatePeds() {
    for (const n of this.nodes) {
      if (n.control === 'signal') continue;
      if (!n.def.pedCrossing) {
        n.pedActive = false;
        this.pedActive[n.idx] = 0;
        continue;
      }
      let rng = this.pedRng.get(n.id);
      if (!rng) {
        rng = Rng.stream(this.config.seed, 'ped:' + n.id);
        this.pedRng.set(n.id, rng);
      }
      if (n.pedNext < 0) n.pedNext = this.t + rng.exp(PED_RATE);
      while (this.t >= n.pedNext) {
        n.pedUntil = Math.max(n.pedUntil, n.pedNext + PED_CROSS);
        n.pedNext += rng.exp(PED_RATE);
      }
      n.pedActive = this.t < n.pedUntil;
      this.pedActive[n.idx] = n.pedActive ? 1 : 0;
    }
  }

  private releaseTrips() {
    const trips = this.trips;
    while (this.tripPtr < trips.length && trips[this.tripPtr].t <= this.t) {
      const trip = trips[this.tripPtr++];
      let q = this.queues.get(trip.oNode);
      if (!q) {
        q = [];
        this.queues.set(trip.oNode, q);
      }
      q.push({ trip, route: null, kind: trip.kind, ver: -1 });
    }
  }

  private prepass() {
    for (const n of this.nodes) n.box.length = 0;
    for (const v of this.active) {
      if (v.boxNode < 0) continue;
      if (v.edge !== v.boxEdge && (v.edge < 0 || v.s > RING_R + v.len)) {
        v.boxNode = v.boxEdge = v.boxIn = -1;
        continue;
      }
      this.nodes[v.boxNode].box.push({ k: v.boxIn, ti: v.boxTi, to: v.boxTo });
    }
    for (const e of this.edges) {
      for (const l of e.lanes) {
        l.cand = null;
        for (const v of l.vehs) {
          if (v.s < e.stopLine) {
            l.cand = v;
            break;
          }
        }
      }
    }
  }

  private accelerations() {
    const la = this.tmp;
    for (const e of this.edges) {
      for (const l of e.lanes) {
        const vs = l.vehs;
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          const v0 = this.desired(v, e);
          let gap = Infinity, dv = 0;
          if (i > 0) {
            const L = vs[i - 1];
            gap = L.s - L.len - v.s;
            dv = v.v - L.v;
          } else if (v.s >= e.stopLine || v.permit || l.cand !== v) {
            this.lookahead(v, e, la);
            gap = la.gap;
            dv = la.dv;
          }
          if (l.cand === v && !v.permit) {
            const og = e.stopLine - v.s;
            if (og < gap) {
              gap = og;
              dv = v.v;
            }
          }
          v.acc = idmAccel(v.v, v0, gap, dv, v.a, v.b, v.s0, v.T * e.tFactor);
        }
      }
    }
  }

  private integrate(dt: number) {
    const m = this.metrics;
    for (const e of this.edges) {
      const node = e.to >= 0 ? this.nodes[e.to] : null;
      const ff = (k: VehicleKind) => freeFlowSpeed(e.def, k);
      for (let li = 0; li < e.lanes.length; li++) {
        const l = e.lanes[li];
        const vs = l.vehs;
        const latTarget = laneOffset(e.def, li);
        for (let i = 0; i < vs.length; i++) {
          const v = vs[i];
          let vNew = v.v + v.acc * dt;
          let ds: number;
          if (vNew < 0) {
            ds = v.acc < 0 ? (-0.5 * v.v * v.v) / v.acc : 0;
            vNew = 0;
          } else ds = 0.5 * (v.v + vNew) * dt;
          let sNew = v.s + ds;
          if (i > 0) {
            const L = vs[i - 1];
            const lim = L.s - L.len - 0.1;
            if (sNew > lim) {
              sNew = Math.max(v.s, lim);
              vNew = Math.min(vNew, L.v);
            }
          }
          if (l.cand === v && !v.permit && sNew > e.stopLine - 0.05) {
            // enforce the stop line (red light, yield, spillback): never cross without permission
            sNew = Math.max(v.s, e.stopLine - 0.05);
            vNew = 0;
          }
          if (node && node.control === 'priority' && v.s < e.stopLine && sNew >= e.stopLine && this.nextEdge(v) >= 0) {
            v.boxNode = node.idx;
            v.boxEdge = e.idx;
            v.boxIn = node.incoming.indexOf(e.idx);
            v.boxTi = e.headingEnd + Math.PI;
            v.boxTo = this.edges[this.nextEdge(v)].headingStart;
          }
          ds = sNew - v.s;
          v.dist += ds;
          m.dist += ds;
          v.freeFlow += ds / ff(v.kind);
          const f = fuelRate(v.kind, vNew, v.acc) * dt;
          v.fuel += f;
          m.fuel += f;
          if (vNew < 2 && e.length - sNew < 40) {
            v.intDelay += dt;
            v.edgeDelay += dt;
          }
          v.s = sNew;
          v.v = vNew;
          const dl = latTarget - v.lat;
          const maxStep = 3 * dt;
          v.lat += Math.abs(dl) <= maxStep ? dl : Math.sign(dl) * maxStep;
        }
      }
    }
  }

  private leaveEdge(v: Veh, e: EdgeRT) {
    e.stats.exits++;
    e.stats.delaySum += v.edgeDelay;
    v.edgeDelay = 0;
    v.permit = false;
    v.stoppedAt = -1;
  }

  private removeActive(v: Veh) {
    const i = v.slot;
    const last = this.active.pop()!;
    if (last !== v) {
      this.active[i] = last;
      last.slot = i;
    }
    v.slot = -1;
  }

  private finishVehicle(v: Veh, completed: boolean) {
    this.removeActive(v);
    if (completed) this.metrics.complete(v, this.t);
  }

  private transitions() {
    for (const e of this.edges) {
      if (e.to < 0) continue;
      const node = this.nodes[e.to];
      for (const l of e.lanes) {
        while (l.vehs.length > 0) {
          const v = l.vehs[0];
          const nx = this.nextEdge(v);
          if (nx >= 0 && node.control === 'roundabout') {
            if (v.s < e.stopLine) break;
            l.vehs.shift();
            this.leaveEdge(v, e);
            v.edge = -1;
            v.ringNode = node.idx;
            v.ringTheta0 = e.headingEnd + Math.PI;
            v.ringProg = 0;
            v.ringR = node.ringR;
            v.ringLen = ringArc(v.ringTheta0, this.edges[nx].headingStart, v.ringR);
            node.ring.push(v);
            continue;
          }
          // trips ending at an interior junction finish at its stop line; at a boundary, at the node
          const endAt = nx >= 0 ? e.length : node.def.kind === 'boundary' ? e.length - 0.5 : e.stopLine - 0.5;
          if (v.s < endAt) break;
          l.vehs.shift();
          this.leaveEdge(v, e);
          if (nx < 0) {
            this.finishVehicle(v, !v.doomed && e.to === v.destNode);
            continue;
          }
          this.enterEdge(v, nx, v.s - e.length);
        }
      }
    }
  }

  private enterEdge(v: Veh, nx: number, s: number) {
    const ne = this.edges[nx];
    const tl = this.targetLane(nx, v);
    const L = ne.lanes[tl];
    const last = L.vehs[L.vehs.length - 1];
    if (last) s = Math.min(s, last.s - last.len - 0.5);
    s = Math.max(0, Math.min(s, ne.length));
    if (last && s > last.s) s = last.s;
    v.edge = nx;
    v.lane = tl;
    v.s = s;
    v.ri++;
    L.vehs.push(v);
    ne.stats.entries++;
  }

  private updateRings(dt: number) {
    const m = this.metrics;
    for (const n of this.nodes) {
      const ring = n.ring;
      for (let i = 0; i < ring.length; ) {
        const v = ring[i];
        if (n.control !== 'roundabout') v.ringProg = v.ringLen;
        if (v.ringProg < v.ringLen) {
          const ds = Math.min(RING_V * dt, v.ringLen - v.ringProg);
          v.ringProg += ds;
          v.v = RING_V;
          v.dist += ds;
          m.dist += ds;
          v.freeFlow += ds / RING_V;
          const f = fuelRate(v.kind, RING_V, 0) * dt;
          v.fuel += f;
          m.fuel += f;
          i++;
          continue;
        }
        const nx = this.nextEdge(v);
        if (nx < 0) {
          ring.splice(i, 1);
          this.finishVehicle(v, !v.doomed && n.idx === v.destNode);
          continue;
        }
        const ne = this.edges[nx];
        const tl = this.targetLane(nx, v);
        const last = ne.lanes[tl].vehs[ne.lanes[tl].vehs.length - 1];
        let place = Math.min(RING_R, ne.length * 0.4);
        if (last && last.s - last.len - 1 < place) {
          if (last.s - last.len - 1 >= 0) place = last.s - last.len - 1;
          else {
            v.v = 0;
            v.intDelay += dt;
            const f = fuelRate(v.kind, 0, 0) * dt;
            v.fuel += f;
            m.fuel += f;
            i++;
            continue;
          }
        }
        ring.splice(i, 1);
        v.ringNode = -1;
        v.lat = laneOffset(ne.def, tl);
        this.enterEdge(v, nx, place);
        v.v = Math.min(RING_V, this.desired(v, ne));
      }
    }
  }

  private spawnLane(e: EdgeRT, kind: VehicleKind, need: number): { lane: number; free: number; lastV: number } | null {
    let best = -1, bestFree = -Infinity, lastV = Infinity;
    for (let i = 0; i < e.lanes.length; i++) {
      const l = e.lanes[i];
      if (!laneAllowed(l.type, kind)) continue;
      const last = l.vehs[l.vehs.length - 1];
      let free = last ? last.s - last.len : Infinity;
      if (kind === VehicleKind.Bus && l.type === LANE_BUS && free !== Infinity) free += 20;
      if (free > bestFree) {
        bestFree = free;
        best = i;
        lastV = last ? last.v : Infinity;
      }
    }
    if (best < 0 || bestFree < need) return null;
    return { lane: best, free: bestFree, lastV };
  }

  private planPending(p: Pending) {
    p.ver = this.netVer;
    const o = this.nodeIdx.get(p.trip.oNode);
    const d = this.nodeIdx.get(p.trip.dNode);
    p.kind = p.trip.kind;
    p.route = null;
    if (o === undefined || d === undefined || o === d) return;
    let route = this.findPath(o, d, p.kind);
    if (!route && p.kind === VehicleKind.Bike) {
      p.kind = VehicleKind.Car;
      route = this.findPath(o, d, p.kind);
    }
    p.route = route;
  }

  private spawn() {
    const max = this.config.maxVehicles;
    for (const q of this.queues.values()) {
      while (q.length > 0) {
        if (this.active.length >= max) return;
        const p = q[0];
        if (p.ver !== this.netVer) this.planPending(p);
        if (!p.route) {
          q.shift();
          this.metrics.unroutable++;
          continue;
        }
        const e = this.edges[p.route[0]];
        const kp = KIND_PARAMS[p.kind];
        const trip = p.trip;
        const T = kp.T * trip.headwayFactor;
        const v0 = Math.max(1, Math.min(e.def.speedLimit * trip.speedFactor, kp.v0));
        const vWant = Math.min(v0 * 0.7, 12);
        const sl = this.spawnLane(e, p.kind, Math.max(kp.s0 + 2, vWant * T * 0.8));
        if (!sl) break;
        q.shift();
        const v = new Veh(this.nextId++, trip.id, p.kind, trip.t);
        v.len = kp.len;
        v.a = kp.a * trip.accelFactor;
        v.b = kp.b;
        v.s0 = kp.s0;
        v.T = T;
        v.speedFactor = trip.speedFactor;
        v.politeness = trip.politeness;
        v.destNode = this.nodeIdx.get(trip.dNode)!;
        v.destZone = trip.dZone;
        v.route = p.route;
        v.ri = 0;
        v.edge = e.idx;
        v.lane = sl.lane;
        v.s = 0;
        v.v = Math.max(0, Math.min(vWant, sl.lastV + 2, (Math.min(sl.free, 1e6) - kp.s0) / T));
        v.lat = laneOffset(e.def, sl.lane);
        v.enterT = this.t;
        v.slot = this.active.length;
        this.active.push(v);
        e.lanes[sl.lane].vehs.push(v);
        e.stats.entries++;
        this.metrics.spawned++;
      }
    }
  }

  private collectStats(dt: number) {
    const m = this.metrics;
    for (const e of this.edges) {
      e.count = 0;
      e.sumSpeed = 0;
      e.queue = 0;
    }
    for (const v of this.active) {
      m.vehTime += dt;
      if (v.edge < 0) continue;
      const e = this.edges[v.edge];
      e.count++;
      e.sumSpeed += v.v;
      if (v.v < 2 && e.isApproach) e.queue++;
    }
    const aFast = Math.min(1, dt / 10);
    const aSlow = Math.min(1, dt / 60);
    let qSum = 0, nAppr = 0, qMax = 0;
    for (const e of this.edges) {
      const st = e.stats;
      const capVeh = Math.max(1, (e.lanes.length * e.length) / 7.5);
      const d = Math.min(1, e.count / capVeh);
      const sr = e.count > 0 ? Math.min(1, e.sumSpeed / e.count / Math.max(0.5, e.def.speedLimit)) : 1;
      const u = Math.max(0, Math.min(1, 0.65 * d + 0.35 * (1 - sr) * Math.min(1, 5 * d)));
      e.util = u;
      st.utilFast += (u - st.utilFast) * aFast;
      st.utilSlow += (u - st.utilSlow) * aSlow;
      st.queueSlow += (e.queue - st.queueSlow) * aSlow;
      st.utilTime += u * dt;
      st.queueTime += e.queue * dt;
      st.vehTime += e.count * dt;
      if (e.queue > st.queueMax) st.queueMax = e.queue;
      if (e.isApproach) {
        qSum += e.queue;
        nAppr++;
        if (e.queue > qMax) qMax = e.queue;
      }
    }
    m.queueAcc += (nAppr ? qSum / nAppr : 0) * dt;
    if (qMax > m.maxQueue) m.maxQueue = qMax;
  }

  private updateObservedSpeeds() {
    for (const e of this.edges) {
      const st = e.stats;
      const target = e.count > 0 ? e.sumSpeed / e.count : e.def.speedLimit;
      st.obsSpeed = 0.5 * st.obsSpeed + 0.5 * target;
    }
  }

  private routeTime(route: number[], from: number, kind: VehicleKind): number {
    const c = this.routeCost(kind);
    let s = 0;
    for (let i = from; i < route.length; i++) s += c(route[i]);
    return s;
  }

  private periodicReroute() {
    for (const v of this.active) {
      if (v.edge < 0 || v.doomed || v.ri + 1 >= v.route.length || v.v >= 2) continue;
      const e = this.edges[v.edge];
      const capVeh = (e.lanes.length * e.length) / 7.5;
      if (e.queue < Math.max(5, 0.4 * capVeh)) continue;
      if (this.rerouteRng.next() >= REROUTE_PROB) continue;
      const path = this.findPath(e.to, v.destNode, v.kind);
      if (!path) continue;
      const oldCost = this.routeTime(v.route, v.ri + 1, v.kind);
      const newCost = this.routeTime(path, 0, v.kind);
      if (newCost < 0.85 * oldCost) {
        v.route = v.route.slice(0, v.ri + 1).concat(path);
        this.metrics.reroutes++;
      }
    }
  }

  private sampleSeries() {
    let sp = 0, queued = 0;
    for (const v of this.active) {
      sp += v.v;
      if (v.v < 2) queued++;
    }
    this.metrics.series.push({
      t: Math.round(this.t * 1000) / 1000,
      active: this.active.length,
      avgSpeed: this.active.length ? sp / this.active.length : 0,
      queued,
      completed: this.metrics.completed,
    });
  }

  // ------------------------------------------------------------ output

  summary(): MetricsSummary {
    return this.metrics.summary(this.t, this.active.length, this.edges);
  }

  /** Vehicles currently waiting at origins (not yet on the network). */
  originQueueLength(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  /** Cumulative vehicles that entered an edge (by id). */
  edgeEntries(id: string): number {
    return this.accumById.get(id)?.entries ?? 0;
  }

  /** Mean intersection delay (s) per vehicle that left the edge (by id). */
  edgeDelay(id: string): number {
    const st = this.accumById.get(id);
    return st && st.exits > 0 ? st.delaySum / st.exits : 0;
  }

  /** Vehicles currently on an edge (by id). */
  edgeCount(id: string): number {
    const i = this.edgeIdx.get(id);
    if (i === undefined) return 0;
    let n = 0;
    for (const l of this.edges[i].lanes) n += l.vehs.length;
    return n;
  }

  frame(running: boolean): SimFrame {
    const n = this.active.length;
    const veh = new Float32Array(n * VEH_STRIDE);
    for (let k = 0; k < n; k++) {
      const v = this.active[k];
      let x: number, y: number, h: number;
      if (v.edge >= 0) {
        const e = this.edges[v.edge];
        const sc = e.poly.length > 1 ? e.poly.length / e.length : 1;
        const p = pointAt(e.poly, (v.s - v.len / 2) * sc, v.lat);
        x = p.x;
        y = p.y;
        h = p.heading;
      } else {
        const node = this.nodes[v.ringNode];
        const phi = ringAngle(v);
        x = node.def.x + v.ringR * Math.cos(phi);
        y = node.def.y + v.ringR * Math.sin(phi);
        h = phi + Math.PI / 2;
      }
      const o = k * VEH_STRIDE;
      veh[o] = x;
      veh[o + 1] = y;
      veh[o + 2] = h;
      veh[o + 3] = v.v;
      veh[o + 4] = v.kind;
      veh[o + 5] = v.id;
      veh[o + 6] = v.destZone;
    }
    const es = new Float32Array(this.edges.length * EDGE_STRIDE);
    for (const e of this.edges) {
      const o = e.idx * EDGE_STRIDE;
      es[o] = e.count;
      es[o + 1] = e.count > 0 ? e.sumSpeed / e.count : e.def.speedLimit;
      es[o + 2] = e.queue;
      es[o + 3] = e.stats.utilFast;
    }
    return {
      t: this.t,
      running,
      finished: this.finished,
      count: n,
      vehicles: veh,
      edgeStats: es,
      aspects: this.aspects.slice(),
      pedActive: this.pedActive.slice(),
      metrics: this.summary(),
    };
  }
}
