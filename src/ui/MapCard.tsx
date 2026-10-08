// The card that opens when you click a road or a junction. Every button
// applies its change at once (undo sits in the toast).

import type { ReactNode } from 'react';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';
import {
  edgeLabel,
  nodeLabel,
  setBikeLane,
  setBusLanes,
  setEdgeClosed,
  setLanes,
  setNodeKind,
  setOneWay,
  setPedCrossing,
  setPedPhase,
  setSignalTiming,
  setSpeedLimit,
  setTwoWay,
} from '../net';
import { EDGE_STRIDE, type NetEdge, type NetNode, type RoadNetwork, type SignalPlan } from '../sim/types';
import { Disclosure, Segmented, Stepper, Switch, useTick } from './controls';
import { kmh, num, toKmh, toMps } from './format';
import { IconClose } from './icons';
import { beginNewRoad, cancelNewRoad } from './interactions';
import { commitEdit, tryEdit } from './uiStore';

const MAX_LANES = 6;

export function MapCard() {
  const selection = useApp((s) => s.selection);
  const network = useApp((s) => s.network);
  if (!selection) return null;
  const edge = selection.kind === 'edge' ? network.edges.find((e) => e.id === selection.id) : undefined;
  const node = selection.kind === 'node' ? network.nodes.find((n) => n.id === selection.id) : undefined;
  if (edge) return <RoadCard key={edge.id} edge={edge} network={network} />;
  if (node) return <JunctionCard key={node.id} node={node} network={network} />;
  return null;
}

function Card({ kind, title, status, children }: { kind: string; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <aside className="card panel" aria-label={`${kind}: ${title}`}>
      <header className="card-head">
        <div className="card-titles">
          <span className="caps">{kind}</span>
          <h2 className="card-title">{title}</h2>
          <p className="card-status" aria-live="polite">
            {status}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => useApp.getState().select(null)}>
          <IconClose />
        </button>
      </header>
      <div className="card-body">{children}</div>
    </aside>
  );
}

function Line({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="card-line">
      <div className="card-line-label">
        <span>{label}</span>
        {hint && <span className="card-hint">{hint}</span>}
      </div>
      <div className="card-line-control">{children}</div>
    </div>
  );
}

function busyWord(u: number) {
  return u > 0.85 ? 'jammed' : u > 0.5 ? 'busy' : 'flowing';
}

const both = (e: NetEdge) => (e.pairId ? [e.id, e.pairId] : [e.id]);

// ---------------------------------------------------------------- road

function RoadCard({ edge, network }: { edge: NetEdge; network: RoadNetwork }) {
  const label = edgeLabel(network, edge.id);
  const street = edge.name && !/^unnamed/i.test(edge.name) ? edge.name : 'This road';
  const twoWay = !!edge.pairId;
  const edit = (fn: () => RoadNetwork, what: string) => tryEdit(() => commitEdit(fn(), `${what} ${street}`));
  const speedKmh = Math.round(toKmh(edge.speedLimit) / 10) * 10 || 10;
  const end = network.nodes.find((n) => n.id === edge.to);

  return (
    <Card kind="Road" title={label} status={<RoadStatus edge={edge} network={network} />}>
      <button
        type="button"
        className={`btn btn-block card-main ${edge.closed ? 'btn-primary' : 'btn-secondary'}`}
        onClick={() => edit(() => setEdgeClosed(network, edge.id, !edge.closed, true), edge.closed ? 'Reopened' : 'Closed')}
      >
        {edge.closed ? 'Reopen road' : 'Close road'}
      </button>

      <Line label="Lanes" hint={twoWay ? 'each direction' : undefined}>
        <Stepper
          label="lanes"
          value={edge.lanes}
          min={1}
          max={MAX_LANES}
          onChange={(v) =>
            edit(() => {
              let n = network;
              for (const id of both(edge)) {
                const e = n.edges.find((x) => x.id === id)!;
                n = setLanes(n, id, v);
                if (e.busLanes > v - 1) n = setBusLanes(n, id, Math.max(0, v - 1));
              }
              return n;
            }, `${v} lane${v > 1 ? 's' : ''} on`)
          }
        />
      </Line>

      <Line label="Speed limit">
        <Stepper
          label="speed limit"
          value={speedKmh}
          min={10}
          max={100}
          step={10}
          unit="km/h"
          onChange={(v) => edit(() => setSpeedLimit(network, edge.id, toMps(v), true), `${v} km/h speed limit on`)}
        />
      </Line>

      <Line label="Bus lane" hint={edge.lanes < 2 && !edge.busLanes ? 'needs 2 lanes' : undefined}>
        <Switch
          label="Bus lane"
          checked={edge.busLanes > 0}
          disabled={edge.lanes < 2 && edge.busLanes === 0}
          onChange={(on) =>
            edit(() => {
              let n = network;
              for (const id of both(edge)) {
                const e = n.edges.find((x) => x.id === id)!;
                if (!on || e.lanes >= 2) n = setBusLanes(n, id, on ? 1 : 0);
              }
              return n;
            }, on ? 'Added a bus lane on' : 'Removed the bus lane on')
          }
        />
      </Line>

      <Line label="Bike lane">
        <Switch
          label="Bike lane"
          checked={edge.bikeLane}
          onChange={(on) => edit(() => setBikeLane(network, edge.id, on, true), on ? 'Added a bike lane on' : 'Removed the bike lane on')}
        />
      </Line>

      <div className="card-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            twoWay ? edit(() => setOneWay(network, edge.id), 'Made one-way:') : edit(() => setTwoWay(network, edge.id), 'Made two-way:')
          }
        >
          {twoWay ? 'Make one-way' : 'Make two-way'}
        </button>
        {end && <NewRoadButton from={end} />}
      </div>
      {twoWay && <p className="card-note">Changes apply to both directions. One-way keeps this direction.</p>}
    </Card>
  );
}

function RoadStatus({ edge, network }: { edge: NetEdge; network: RoadNetwork }) {
  useTick(500);
  if (edge.closed) return <span className="status-bad">Closed to traffic</span>;
  const idx = network.edges.findIndex((e) => e.id === edge.id);
  const stats = sim.latest?.edgeStats;
  const at = idx * EDGE_STRIDE;
  if (!stats || idx < 0 || at + 3 >= stats.length) return <>No traffic yet</>;
  const cars = stats[at];
  const speed = stats[at + 1];
  const u = stats[at + 3];
  if (cars < 0.5) return <>No cars right now · limit {kmh(edge.speedLimit, 0)} km/h</>;
  return (
    <>
      {num(cars)} car{Math.round(cars) === 1 ? '' : 's'} · {kmh(speed, 0)} km/h · <span className={`status-${busyWord(u)}`}>{busyWord(u)}</span>
    </>
  );
}

// ---------------------------------------------------------------- junction

type Control = 'signal' | 'roundabout' | 'priority';
const CONTROL_OPTIONS: { value: Control; label: string }[] = [
  { value: 'signal', label: 'Traffic lights' },
  { value: 'roundabout', label: 'Roundabout' },
  { value: 'priority', label: 'Stop signs' },
];
const CONTROL_WORD: Record<Control, string> = { signal: 'traffic lights', roundabout: 'a roundabout', priority: 'stop signs' };

function JunctionCard({ node, network }: { node: NetNode; network: RoadNetwork }) {
  const label = nodeLabel(network, node.id);
  const plan = network.signals.find((p) => p.nodeId === node.id);
  const edit = (fn: () => RoadNetwork, what: string) => tryEdit(() => commitEdit(fn(), what));

  if (node.kind === 'boundary') {
    return (
      <Card kind="Map edge" title={label} status="Cars enter and leave the map here.">
        <div className="card-actions">
          <NewRoadButton from={node} />
        </div>
      </Card>
    );
  }

  return (
    <Card kind="Junction" title={label} status={<JunctionStatus node={node} network={network} />}>
      <Segmented<Control>
        label="How traffic is controlled"
        value={node.kind}
        options={CONTROL_OPTIONS}
        onChange={(k) => edit(() => setNodeKind(network, node.id, k), `Made ${label} ${CONTROL_WORD[k]}`)}
      />

      {node.kind === 'signal' && plan && <GreenTimes plan={plan} label={label} />}
      {node.kind === 'roundabout' && <p className="card-note">Cars entering give way to cars already going round.</p>}
      {node.kind === 'priority' && <p className="card-note">Side streets stop and give way to the main road.</p>}

      <Line label="Crosswalk" hint={node.kind === 'signal' ? 'adds a walk phase' : undefined}>
        <Switch
          label="Crosswalk"
          checked={!!node.pedCrossing}
          onChange={(on) =>
            edit(() => {
              let n = setPedCrossing(network, node.id, on);
              if (node.kind === 'signal') n = setPedPhase(n, node.id, on ? 12 : 0);
              return n;
            }, `${on ? 'Added a crosswalk at' : 'Removed the crosswalk at'} ${label}`)
          }
        />
      </Line>

      <div className="card-actions">
        <NewRoadButton from={node} />
      </div>
    </Card>
  );
}

function JunctionStatus({ node, network }: { node: NetNode; network: RoadNetwork }) {
  useTick(500);
  const stats = sim.latest?.edgeStats;
  const control = node.kind === 'signal' ? 'Traffic lights' : node.kind === 'roundabout' ? 'Roundabout' : 'Stop signs';
  if (!stats) return <>{control}</>;
  let waiting = 0;
  network.edges.forEach((e, i) => {
    if (e.to === node.id && i * EDGE_STRIDE + 2 < stats.length) waiting += stats[i * EDGE_STRIDE + 2];
  });
  return (
    <>
      {control} · {num(waiting)} car{Math.round(waiting) === 1 ? '' : 's'} waiting
    </>
  );
}

type TimingKey = 'green' | 'yellow' | 'allRed';
const LIMITS: Record<TimingKey, { min: number; max: number; step: number; word: string }> = {
  green: { min: 5, max: 120, step: 5, word: 'green' },
  yellow: { min: 2, max: 6, step: 0.5, word: 'yellow' },
  allRed: { min: 0, max: 5, step: 0.5, word: 'all-red' },
};

function GreenTimes({ plan, label }: { plan: SignalPlan; label: string }) {
  const setTiming = (i: number, key: TimingKey, v: number) =>
    tryEdit(() => {
      const net = useApp.getState().network;
      const ph = plan.phases[i];
      commitEdit(setSignalTiming(net, plan.nodeId, i, { [key]: v }), `${ph.name} ${LIMITS[key].word} at ${label} set to ${num(v, v % 1 ? 1 : 0)} s`);
    });
  const cycle = plan.phases.reduce((t, p) => t + p.green + p.yellow + p.allRed, 0) + plan.pedPhase;

  return (
    <div className="card-group">
      <div className="card-group-head">
        <span>Green time</span>
        <span className="card-hint">one full cycle {num(cycle)} s</span>
      </div>
      {plan.phases.map((p, i) => (
        <Line key={i} label={p.name}>
          <Stepper label={`${p.name} green time`} value={p.green} {...LIMITS.green} unit="s" onChange={(v) => setTiming(i, 'green', v)} />
        </Line>
      ))}
      <Disclosure label="Timing details" className="card-more">
        {plan.phases.map((p, i) => (
          <div key={i} className="timing">
            <span className="timing-name">{p.name}</span>
            <Line label="Yellow">
              <Stepper label={`${p.name} yellow`} value={p.yellow} {...LIMITS.yellow} digits={1} unit="s" onChange={(v) => setTiming(i, 'yellow', v)} />
            </Line>
            <Line label="All-red">
              <Stepper label={`${p.name} all-red`} value={p.allRed} {...LIMITS.allRed} digits={1} unit="s" onChange={(v) => setTiming(i, 'allRed', v)} />
            </Line>
          </div>
        ))}
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------- new road

function NewRoadButton({ from }: { from: NetNode }) {
  const pending = useApp((s) => (s.tool === 'newRoad' ? s.pendingNode : null));
  const network = useApp((s) => s.network);
  if (pending) {
    return (
      <div className="pick-hint" role="status">
        <span>
          New road from <strong>{nodeLabel(network, pending)}</strong>. Click the junction it should go to.
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={cancelNewRoad}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="btn btn-secondary" onClick={() => beginNewRoad(from.id)}>
      Build a new road from here…
    </button>
  );
}
