import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';
import {
  edgeLabel,
  setBikeLane,
  setBusLanes,
  setCapacity,
  setEdgeClosed,
  setLanes,
  setOneWay,
  setSpeedLimit,
  setTwoWay,
} from '../net';
import { EDGE_STRIDE, type NetEdge, type RoadNetwork } from '../sim/types';
import { Field, NumberInput, Row, SectionHead, Segmented, Stepper, Switch, useTick, Val } from './controls';
import { kmh, num, pct, toKmh, toMps } from './format';
import { commitEdit, tryEdit } from './uiStore';

const DEFAULT_CAPACITY = 1800;

export function EdgeInspector({ edge }: { edge: NetEdge }) {
  const network = useApp((s) => s.network);
  const label = edgeLabel(network, edge.id);
  const edit = (next: () => RoadNetwork, what: string) => tryEdit(() => commitEdit(next(), `${label}: ${what}`));

  return (
    <div className="inspector-body">
      <header className="inspector-title">
        <h2>{label}</h2>
        <p className="muted mono">
          {num(edge.length)} m · {edge.pairId ? 'two-way' : 'one-way'}
          {edge.roadClass ? ` · ${edge.roadClass}` : ''}
          {edge.closed && <span className="tag tag-bad">Closed</span>}
        </p>
      </header>

      <EdgeLiveStats edge={edge} />

      <SectionHead>Geometry</SectionHead>
      <div className="form-grid">
        <Field label="Lanes">
          {() => (
            <Stepper
              label="lanes"
              value={edge.lanes}
              min={1}
              max={6}
              onChange={(v) =>
                edit(() => {
                  let n = setLanes(network, edge.id, v);
                  // keep at least one general lane
                  if (edge.busLanes > v - 1) n = setBusLanes(n, edge.id, Math.max(0, v - 1));
                  return n;
                }, `${v} lane${v > 1 ? 's' : ''}`)
              }
            />
          )}
        </Field>
        <Field label="Capacity" hint="Saturation flow per lane">
          {(id) => (
            <span className="input-unit">
              <NumberInput
                id={id}
                value={edge.capacity ?? DEFAULT_CAPACITY}
                min={200}
                max={2400}
                step={50}
                onCommit={(v) => edit(() => setCapacity(network, edge.id, v), `capacity ${num(v)} veh/h/lane`)}
              />
              <span className="unit">veh/h/lane</span>
            </span>
          )}
        </Field>
        <Field label="Direction">
          {() => (
            <Segmented
              label="Direction"
              size="sm"
              value={edge.pairId ? 'two' : 'one'}
              options={[
                { value: 'two', label: 'Two-way' },
                { value: 'one', label: 'One-way' },
              ]}
              onChange={(v) =>
                v === 'one'
                  ? edit(() => setOneWay(network, edge.id), 'made one-way')
                  : edit(() => setTwoWay(network, edge.id), 'made two-way')
              }
            />
          )}
        </Field>
        <Field label="Closed">
          {() => (
            <Switch
              label="Road closed"
              checked={edge.closed}
              onChange={(v) => edit(() => setEdgeClosed(network, edge.id, v, true), v ? 'closed' : 'reopened')}
            />
          )}
        </Field>
      </div>

      <SpeedLimitField edge={edge} label={label} />

      <SectionHead>Lane use</SectionHead>
      <div className="form-grid">
        <Field label="Bus lanes" hint={edge.lanes < 2 ? 'Needs at least 2 lanes' : undefined}>
          {() => (
            <Stepper
              label="bus lanes"
              value={edge.busLanes}
              min={0}
              max={Math.max(0, edge.lanes - 1)}
              disabled={edge.lanes < 2 && edge.busLanes === 0}
              onChange={(v) => edit(() => setBusLanes(network, edge.id, v), `${v} bus lane${v === 1 ? '' : 's'}`)}
            />
          )}
        </Field>
        <Field label="Bike lane">
          {() => (
            <Switch
              label="Protected bike lane"
              checked={edge.bikeLane}
              onChange={(v) => edit(() => setBikeLane(network, edge.id, v, true), v ? 'added bike lane' : 'removed bike lane')}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

function EdgeLiveStats({ edge }: { edge: NetEdge }) {
  useTick(250);
  const network = useApp((s) => s.network);
  const idx = network.edges.findIndex((e) => e.id === edge.id);
  const stats = sim.latest?.edgeStats;
  const at = idx * EDGE_STRIDE;
  const has = !!stats && idx >= 0 && at + 3 < stats.length;
  const vehicles = has ? stats![at] : undefined;
  const speed = has ? stats![at + 1] : undefined;
  const queue = has ? stats![at + 2] : undefined;
  const util = has ? stats![at + 3] : undefined;
  return (
    <>
      <SectionHead aside={<span className="muted caps">{has ? 'Live' : 'Not running'}</span>}>Now</SectionHead>
      <dl className="readout">
        <Row label="Vehicles">
          <Val v={num(vehicles)} unit="veh" />
        </Row>
        <Row label="Avg speed">
          <Val v={vehicles ? kmh(speed) : '–'} unit="km/h" />
        </Row>
        <Row label="Utilization">
          <span className="util">
            <span className="util-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (util ?? 0) * 100)}%`, background: utilColor(util ?? 0) }} />
            </span>
            <Val v={pct(util)} unit="%" />
          </span>
        </Row>
        <Row label="Queue">
          <Val v={num(queue)} unit="veh" />
        </Row>
      </dl>
    </>
  );
}

export function utilColor(u: number) {
  return u > 0.85 ? 'var(--flow-jam)' : u > 0.5 ? 'var(--flow-mid)' : 'var(--flow-free)';
}

function SpeedLimitField({ edge, label }: { edge: NetEdge; label: string }) {
  const current = Math.round(toKmh(edge.speedLimit));
  const [draft, setDraft] = useState(current);
  const [both, setBoth] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => setDraft(current), [current]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const schedule = (v: number) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v === current) return;
      tryEdit(() =>
        commitEdit(
          setSpeedLimit(useApp.getState().network, edge.id, toMps(v), both && !!edge.pairId),
          `${label}: speed limit ${v} km/h${both && edge.pairId ? ' (both directions)' : ''}`,
        ),
      );
    }, 350);
  };

  return (
    <>
      <SectionHead>Speed limit</SectionHead>
      <div className="speed-field">
        <input
          type="range"
          className="range"
          min={20}
          max={100}
          step={5}
          value={draft}
          aria-label="Speed limit km/h"
          onChange={(e) => schedule(Number(e.target.value))}
        />
        <span className="input-unit">
          <NumberInput value={draft} min={20} max={100} step={5} width={5} onCommit={schedule} />
          <span className="unit">km/h</span>
        </span>
      </div>
      {edge.pairId && (
        <label className="check">
          <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />
          Apply to both directions
        </label>
      )}
    </>
  );
}
