import { useState } from 'react';
import { useApp, type HeatMode } from '../app/store';
import { sim } from '../app/simBridge';
import { edgeLabel } from '../net';
import { requestFocus } from '../render';
import { EDGE_STRIDE } from '../sim/types';
import { Row, SectionHead, Segmented, Val } from './controls';
import { utilColor } from './EdgeInspector';
import { clock, kmh, minutes, num, pct, toKmh } from './format';
import { IconUndo } from './icons';
import { SaveScenarioForm } from './SaveScenarioForm';
import { Sparkline } from './Sparkline';
import { undoLastEdit, useUI } from './uiStore';

export function Dashboard() {
  const sheetOpen = useUI((s) => s.sheetOpen);
  return (
    <aside className={`dashboard${sheetOpen ? ' is-open' : ''}`} aria-label="Metrics">
      <div className="sheet-grip">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => useUI.getState().setSheetOpen(false)}>
          Hide metrics
        </button>
      </div>
      <SimulationSection />
      <NetworkSection />
      <Hotspots />
      <HeatSection />
      <EditsSection />
    </aside>
  );
}

function SimulationSection() {
  const m = useApp((s) => s.metrics);
  const config = useApp((s) => s.config);
  const simTime = useApp((s) => s.simTime);
  const series = m?.series ?? [];
  return (
    <section className="dash-section">
      <SectionHead aside={<span className="mono muted">{clock(simTime)} / {clock(config.duration)}</span>}>Simulation</SectionHead>
      <dl className="readout">
        <Row label="Vehicles active">
          <Val v={`${num(m?.active)} / ${num(config.maxVehicles)}`} unit="veh" />
        </Row>
        {series.length > 1 && (<div className="spark-row">
          <Sparkline values={series.map((p) => p.active)} label="Active vehicles over time" />
        </div>)}
        <Row label="Avg speed">
          <Val v={kmh(m?.avgSpeed)} unit="km/h" />
        </Row>
        {series.length > 1 && (<div className="spark-row">
          <Sparkline values={series.map((p) => toKmh(p.avgSpeed))} label="Average speed over time" />
        </div>)}
        <Row label="Avg travel time">
          <Val v={minutes(m?.avgTravelTime)} unit="min" />
        </Row>
        <Row label="Completed trips">
          <Val v={num(m?.completedTrips)} unit="trips" />
        </Row>
        <Row label="Spawned">
          <Val v={num(m?.spawned)} unit="veh" />
        </Row>
      </dl>
    </section>
  );
}

function NetworkSection() {
  const m = useApp((s) => s.metrics);
  return (
    <section className="dash-section">
      <SectionHead>Network</SectionHead>
      <dl className="readout">
        <Row label="Congested roads" title="Utilization above 85 % or queue above 10 veh">
          <Val v={num(m?.congestedRoads)} unit="links" />
        </Row>
        <Row label="Mean utilization">
          <Val v={pct(m?.utilization)} unit="%" />
        </Row>
        <Row label="Avg delay" title="Travel time minus free-flow time, per trip">
          <Val v={minutes(m?.avgDelay, 2)} unit="min" />
        </Row>
        <Row label="Intersection delay" title="Delay within 40 m of a junction, per completed trip">
          <Val v={num(m?.intersectionDelay, 1)} unit="s/trip" />
        </Row>
        <Row label="Throughput">
          <Val v={num(m?.throughput)} unit="veh/h" />
        </Row>
        <Row label="Avg queue">
          <Val v={num(m?.avgQueue, 1)} unit="veh" />
        </Row>
        <Row label="Max queue">
          <Val v={num(m?.maxQueue)} unit="veh" />
        </Row>
        <Row label="Distance">
          <Val v={num(m?.distance, 1)} unit="km" />
        </Row>
        <Row label="Reroutes">
          <Val v={num(m?.reroutes)} unit="veh" />
        </Row>
        <Row label="Fuel">
          <Val v={num(m?.fuel, 1)} unit="L" />
        </Row>
        <Row label="CO₂">
          <Val v={num(m?.co2, 1)} unit="kg" />
        </Row>
        {!!m?.unroutable && (
          <Row label="Unroutable trips" tone="bad" title="Trips dropped because no route exists">
            <Val v={num(m.unroutable)} unit="trips" />
          </Row>
        )}
      </dl>
    </section>
  );
}

function Hotspots() {
  const hotspots = useApp((s) => s.metrics?.hotspots);
  const network = useApp((s) => s.network);
  const selection = useApp((s) => s.selection);
  const list = (hotspots ?? []).slice(0, 5);
  const stats = sim.latest?.edgeStats;
  return (
    <section className="dash-section">
      <SectionHead aside={<span className="caps muted">Utilization</span>}>Hotspots</SectionHead>
      {list.length === 0 ? (
        <p className="muted small">No congested links{hotspots ? ' right now' : ' yet. Start the run'}.</p>
      ) : (
        <ol className="hotspots">
          {list.map((id, i) => {
            const idx = network.edges.findIndex((e) => e.id === id);
            const u = stats && idx >= 0 ? stats[idx * EDGE_STRIDE + 3] : undefined;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="hotspot"
                  aria-current={selection?.kind === 'edge' && selection.id === id}
                  onClick={() => {
                    useApp.getState().select({ kind: 'edge', id });
                    requestFocus({ kind: 'edge', id });
                  }}
                >
                  <span className="mono muted">{i + 1}</span>
                  <span className="hotspot-name">{idx >= 0 ? edgeLabel(network, id) : id}</span>
                  <span className="mono">
                    <span className="dot" style={{ background: utilColor(u ?? 1) }} aria-hidden="true" />
                    {pct(u)}
                    <span className="unit">%</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const LEGEND: Record<Exclude<HeatMode, 'off'>, [string, string]> = {
  utilization: ['0 %', '100 %'],
  speed: ['At limit', 'Stopped'],
  queue: ['No queue', 'Link storage full'],
};

function HeatSection() {
  const heat = useApp((s) => s.heat);
  return (
    <section className="dash-section">
      <SectionHead>Road colour</SectionHead>
      <Segmented<HeatMode>
        label="Road colour"
        size="sm"
        value={heat}
        onChange={(h) => useApp.getState().setHeat(h)}
        options={[
          { value: 'utilization', label: 'Utilization' },
          { value: 'speed', label: 'Speed' },
          { value: 'queue', label: 'Queue' },
          { value: 'off', label: 'Off' },
        ]}
      />
      {heat !== 'off' && (
        <div className="legend">
          <span className="legend-ramp" aria-hidden="true" />
          <span className="legend-ends mono">
            <span>{LEGEND[heat][0]}</span>
            <span>{LEGEND[heat][1]}</span>
          </span>
        </div>
      )}
    </section>
  );
}

function EditsSection() {
  const edits = useApp((s) => s.edits);
  const canUndo = useUI((s) => s.undo.length > 0);
  const [saving, setSaving] = useState(false);
  return (
    <section className="dash-section">
      <SectionHead
        aside={
          canUndo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={undoLastEdit} title="Undo last edit (Ctrl+Z)">
              <IconUndo />
              Undo
            </button>
          )
        }
      >
        Edits
      </SectionHead>
      {edits.length === 0 ? (
        <p className="muted small">No changes to the loaded network.</p>
      ) : (
        <ol className="edits">
          {edits.map((e, i) => (
            <li key={i}>
              <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
              <span>{e}</span>
            </li>
          ))}
        </ol>
      )}
      {saving ? (
        <SaveScenarioForm onDone={() => setSaving(false)} autoFocus />
      ) : (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setSaving(true)}>
          Save as scenario
        </button>
      )}
    </section>
  );
}
