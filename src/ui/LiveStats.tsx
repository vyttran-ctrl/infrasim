// Slim live readout: four numbers and a one-word traffic state. Everything
// else hides under "More stats".

import { useApp, type HeatMode } from '../app/store';
import { sim } from '../app/simBridge';
import { edgeLabel } from '../net';
import { requestFocus } from '../render';
import { EDGE_STRIDE, type MetricsSummary } from '../sim/types';
import { Disclosure, Row, Segmented, Val } from './controls';
import { DASH, kmh, minutes, num, pct, toKmh } from './format';
import { IconUndo } from './icons';
import { Sparkline } from './Sparkline';
import { undoLastEdit, useUI } from './uiStore';

export type TrafficState = 'Flowing' | 'Busy' | 'Jammed';

/** One word for the whole map, from mean utilization and the share of congested roads. */
export function trafficState(m: MetricsSummary, roads: number): TrafficState {
  const congested = roads > 0 ? m.congestedRoads / roads : 0;
  if (m.utilization > 0.5 || congested > 0.15) return 'Jammed';
  if (m.utilization > 0.25 || congested > 0.05) return 'Busy';
  return 'Flowing';
}

export function LiveStats() {
  const m = useApp((s) => s.metrics);
  const roads = useApp((s) => s.network.edges.length);
  const status = useApp((s) => s.status);
  const state = m && m.spawned > 0 ? trafficState(m, roads) : null;

  return (
    <section className="live panel" aria-label="Live traffic">
      <div className="live-head">
        <span className="caps">Traffic now</span>
        {state ? (
          <span className={`badge badge-${state.toLowerCase()}`}>{state}</span>
        ) : (
          <span className="muted small">{status === 'running' ? 'Starting…' : 'Not running'}</span>
        )}
      </div>
      <dl className="live-grid">
        <Big label="Cars on the road" value={num(m?.active)} unit="cars" />
        <Big label="Average speed" value={kmh(m?.avgSpeed, 0)} unit="km/h" />
        <Big label="Average trip time" value={m?.completedTrips ? minutes(m.avgTravelTime) : DASH} unit="min" />
        <Big label="Trips completed" value={num(m?.completedTrips)} unit="trips" />
      </dl>
      <Disclosure label="More stats" className="live-more">
        <MoreStats m={m} />
      </Disclosure>
    </section>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="big">
      <dt>{label}</dt>
      <dd className="mono">
        {value}
        <span className="unit">{unit}</span>
      </dd>
    </div>
  );
}

function MoreStats({ m }: { m: MetricsSummary | null }) {
  const series = m?.series ?? [];
  return (
    <div className="more">
      {series.length > 1 && (
        <div className="sparks">
          <figure>
            <figcaption className="caps">Cars on the road</figcaption>
            <Sparkline values={series.map((p) => p.active)} label="Cars on the road over time" width={120} />
          </figure>
          <figure>
            <figcaption className="caps">Average speed</figcaption>
            <Sparkline values={series.map((p) => toKmh(p.avgSpeed))} label="Average speed over time" width={120} />
          </figure>
        </div>
      )}
      <dl className="readout">
        <Row label="Average delay" title="Extra time compared with empty roads, per trip">
          <Val v={minutes(m?.avgDelay, 2)} unit="min" />
        </Row>
        <Row label="Waiting at junctions">
          <Val v={num(m?.intersectionDelay, 1)} unit="s per trip" />
        </Row>
        <Row label="Trips per hour">
          <Val v={num(m?.throughput)} unit="trips/h" />
        </Row>
        <Row label="Longest queue">
          <Val v={num(m?.maxQueue)} unit="cars" />
        </Row>
        <Row label="Average queue">
          <Val v={num(m?.avgQueue, 1)} unit="cars" />
        </Row>
        <Row label="Congested roads" title="Roads more than 85% full or with more than 10 cars queued">
          <Val v={num(m?.congestedRoads)} unit="roads" />
        </Row>
        <Row label="How full the roads are">
          <Val v={pct(m?.utilization)} unit="%" />
        </Row>
        <Row label="Cars started">
          <Val v={num(m?.spawned)} unit="cars" />
        </Row>
        <Row label="Distance driven">
          <Val v={num(m?.distance, 1)} unit="km" />
        </Row>
        <Row label="Cars that changed route">
          <Val v={num(m?.reroutes)} unit="cars" />
        </Row>
        <Row label="Fuel used">
          <Val v={num(m?.fuel, 1)} unit="L" />
        </Row>
        <Row label="CO₂ emitted">
          <Val v={num(m?.co2, 1)} unit="kg" />
        </Row>
        {!!m?.unroutable && (
          <Row label="Trips with no route" tone="bad" title="Trips dropped because no road leads to the destination">
            <Val v={num(m.unroutable)} unit="trips" />
          </Row>
        )}
      </dl>
      <Hotspots />
      <RoadColour />
      <Edits />
    </div>
  );
}

function Hotspots() {
  const hotspots = useApp((s) => s.metrics?.hotspots);
  const network = useApp((s) => s.network);
  const list = (hotspots ?? []).slice(0, 5);
  const stats = sim.latest?.edgeStats;
  return (
    <div className="more-block">
      <h3 className="caps">Busiest roads</h3>
      {list.length === 0 ? (
        <p className="muted small">No jammed roads right now.</p>
      ) : (
        <ol className="hotspots">
          {list.map((id) => {
            const idx = network.edges.findIndex((e) => e.id === id);
            const u = stats && idx >= 0 ? stats[idx * EDGE_STRIDE + 3] : undefined;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="hotspot"
                  onClick={() => {
                    useApp.getState().select({ kind: 'edge', id });
                    requestFocus({ kind: 'edge', id });
                  }}
                >
                  <span className="hotspot-name">{idx >= 0 ? edgeLabel(network, id) : id}</span>
                  <span className="mono">
                    {pct(u)}
                    <span className="unit">% full</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function RoadColour() {
  const heat = useApp((s) => s.heat);
  return (
    <div className="more-block">
      <h3 className="caps">Colour roads by</h3>
      <Segmented<HeatMode>
        label="Colour roads by"
        size="sm"
        value={heat}
        onChange={(h) => useApp.getState().setHeat(h)}
        options={[
          { value: 'utilization', label: 'How full' },
          { value: 'speed', label: 'Speed' },
          { value: 'queue', label: 'Queues' },
          { value: 'off', label: 'Off' },
        ]}
      />
    </div>
  );
}

function Edits() {
  const edits = useApp((s) => s.edits);
  const canUndo = useUI((s) => s.undo.length > 0);
  return (
    <div className="more-block">
      <h3 className="caps">Your changes</h3>
      {edits.length === 0 ? (
        <p className="muted small">None yet. Click a road or junction on the map.</p>
      ) : (
        <ol className="edits">
          {edits.map((e, i) => (
            <li key={i}>
              <span className="mono muted">{i + 1}</span>
              <span>{e}</span>
            </li>
          ))}
        </ol>
      )}
      {canUndo && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={undoLastEdit}>
          <IconUndo />
          Undo last change
        </button>
      )}
    </div>
  );
}

/** Tiny congestion key, bottom left. */
export function Legend() {
  const heat = useApp((s) => s.heat);
  if (heat === 'off') return null;
  const ends: Record<Exclude<HeatMode, 'off'>, [string, string]> = {
    utilization: ['Free', 'Jammed'],
    speed: ['At the limit', 'Stopped'],
    queue: ['No queue', 'Long queue'],
  };
  return (
    <div className="legend" aria-label="Road colours">
      <span>{ends[heat][0]}</span>
      <span className="legend-ramp" aria-hidden="true" />
      <span>{ends[heat][1]}</span>
    </div>
  );
}
