import { useState } from 'react';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';
import { nodeLabel, setNodeKind } from '../net';
import type { Scenario, SimConfig } from '../sim/types';
import { MetricBars, seriesColor, SpeedOverTime } from './CompareCharts';
import { dateTime, minutes, num } from './format';
import { IconClose } from './icons';
import { ResultsTable } from './ResultsTable';
import { trafficLabel } from './RunBar';
import { SaveScenarioForm } from './SaveScenarioForm';
import { centralSignal } from './testRun';
import { flash, tryEdit } from './uiStore';

const DEMO_QUESTION = 'Would replacing an existing four-way intersection with a roundabout improve network performance?';
const DEMO_A = 'Existing signal';
const DEMO_B = 'Roundabout';
const PARALLEL = 2;

interface Job {
  state: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  error?: string;
}

const configKey = (c: SimConfig) => `${c.seed}|${c.demand}|${c.duration}|${c.maxVehicles}|${c.spawnRate}|${c.dt}`;

export function describeConfig(c: SimConfig) {
  const preset = `${trafficLabel(c.demand).toLowerCase()} traffic`;
  return `seed ${c.seed}, ${preset}, ${num(c.duration / 60)} min, up to ${num(c.maxVehicles)} cars`;
}

export function CompareDrawer() {
  const open = useApp((s) => s.compareOpen);
  const scenarios = useApp((s) => s.scenarios);
  const compareIds = useApp((s) => s.compareIds);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [ranWith, setRanWith] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const compared = compareIds.map((id) => scenarios.find((s) => s.id === id)).filter((s): s is Scenario => !!s);
  const shared = compared[0]?.config;
  const sharedKey = shared ? configKey(shared) : '';
  const isDemo = compared.some((s) => s.name === DEMO_A) && compared.some((s) => s.name === DEMO_B);
  const stale = compared.some((s) => s.result && ranWith[s.id] !== sharedKey);
  const withResults = compared.filter((s) => s.result);

  const update = (id: string, patch: Partial<Job>) => setJobs((j) => ({ ...j, [id]: { ...j[id], ...patch } }));

  const runComparison = async () => {
    if (!shared || compared.length < 2) return;
    const cfg: SimConfig = { ...shared };
    const key = configKey(cfg);
    const queue = [...compared];
    setRunning(true);
    setJobs(Object.fromEntries(queue.map((s) => [s.id, { state: 'queued', progress: 0 } as Job])));
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const id = s.id;
        update(id, { state: 'running' });
        try {
          const result = await sim.runHeadless(s.network, cfg, (f) => update(id, { progress: f }));
          useApp.getState().setScenarioResult(id, result);
          setRanWith((r) => ({ ...r, [id]: key }));
          update(id, { state: 'done', progress: 1 });
        } catch (e) {
          update(id, { state: 'error', error: e instanceof Error ? e.message : 'Run failed' });
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setRunning(false);
  };

  return (
    <section className={`drawer${open ? ' is-open' : ''}`} aria-label="Compare scenarios" aria-hidden={!open}>
      <header className="drawer-head">
        <div>
          <h2 className="drawer-title">Compare scenarios</h2>
          <p className="drawer-sub">{isDemo ? DEMO_QUESTION : 'Save versions of the map and compare them side by side. Every scenario runs with the same traffic.'}</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close comparison (Esc)"
          title="Close (Esc)"
          tabIndex={open ? 0 : -1}
          onClick={() => useApp.getState().setCompareOpen(false)}
        >
          <IconClose />
        </button>
      </header>

      {scenarios.length < 2 ? (
        <EmptyCompare />
      ) : (
        <div className="drawer-body">
          <div className="scen-col">
            <div className="scen-col-head">
              <SaveScenarioForm />
              <span className="muted small">Tick the scenarios to compare. The first one ticked is the baseline.</span>
            </div>
            <ul className="scen-list">
              {scenarios.map((s) => (
                <ScenarioRow
                  key={s.id}
                  s={s}
                  order={compareIds.indexOf(s.id)}
                  job={jobs[s.id]}
                  disabled={running}
                  focusable={open}
                />
              ))}
            </ul>
            <div className="run-cmp">
              {shared && <p className="small">All scenarios run with {describeConfig(shared)}.</p>}
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={running || compared.length < 2}
                tabIndex={open ? 0 : -1}
                onClick={runComparison}
              >
                {running ? 'Running comparison…' : `Run comparison (${compared.length})`}
              </button>
              {compared.length < 2 && <p className="muted small">Tick at least two scenarios.</p>}
              <DemoButton disabled={running} focusable={open} />
            </div>
          </div>

          <div className="results-col">
            {withResults.length === 0 ? (
              <p className="muted results-empty">Run the comparison to fill the results table.</p>
            ) : (
              <>
                {stale && (
                  <p className="msg">Some results come from an earlier run or different settings. Run the comparison again so every column uses {shared ? describeConfig(shared) : 'the same settings'}.</p>
                )}
                <ResultsTable scenarios={compared} />
                <div className="charts">
                  <MetricBars scenarios={compared} />
                  <SpeedOverTime scenarios={compared} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ScenarioRow({ s, order, job, disabled, focusable }: { s: Scenario; order: number; job?: Job; disabled: boolean; focusable: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ticked = order >= 0;
  const tab = focusable ? 0 : -1;
  return (
    <li className={`scen${ticked ? ' is-ticked' : ''}`}>
      <label className="scen-tick">
        <input type="checkbox" checked={ticked} disabled={disabled} tabIndex={tab} onChange={() => useApp.getState().toggleCompare(s.id)} />
        {ticked && <span className="swatch" style={{ background: seriesColor(order) }} aria-hidden="true" />}
        <span className="scen-name">{s.name}</span>
        {order === 0 && <span className="tag">Baseline</span>}
      </label>
      {s.note && <p className="scen-note">{s.note}</p>}
      <p className="scen-meta muted mono">
        {dateTime(s.createdAt)} · {s.network.name}
      </p>
      <div className="scen-status">
        {job && job.state !== 'done' ? (
          job.state === 'error' ? (
            <span className="msg-bad small">{job.error}</span>
          ) : (
            <span className="scen-progress">
              <span className="progress">
                <span style={{ transform: `scaleX(${job.progress})` }} />
              </span>
              <span className="mono small">{job.state === 'queued' ? 'queued' : `${Math.round(job.progress * 100)} %`}</span>
            </span>
          )
        ) : s.result ? (
          <span className="mono small">
            {minutes(s.result.avgTravelTime, 2)} <span className="unit">min travel</span> · {num(s.result.completedTrips)} <span className="unit">trips</span>
          </span>
        ) : (
          <span className="muted small">Not run</span>
        )}
        <span className="scen-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            tabIndex={tab}
            disabled={disabled}
            onClick={() => {
              useApp.getState().restoreScenario(s.id);
              useApp.getState().start();
              flash(`Restored "${s.name}" to the map.`);
            }}
            title="Put this version back on the map"
          >
            Restore
          </button>
          {confirmDelete ? (
            <>
              <button type="button" className="btn btn-danger btn-sm" tabIndex={tab} onClick={() => useApp.getState().removeScenario(s.id)}>
                Delete
              </button>
              <button type="button" className="btn btn-ghost btn-sm" tabIndex={tab} onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" tabIndex={tab} disabled={disabled} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function EmptyCompare() {
  return (
    <div className="drawer-empty">
      <p>Save at least two versions of the map to compare them. Save the map as it is, change something, then save again.</p>
      <SaveScenarioForm />
      <DemoButton focusable />
    </div>
  );
}

/** Builds the final-demo pair: the most central signal as-is vs. as a roundabout. */
function DemoButton({ disabled, focusable }: { disabled?: boolean; focusable: boolean }) {
  return (
    <div className="demo">
      <button type="button" className="btn btn-secondary" disabled={disabled} tabIndex={focusable ? 0 : -1} onClick={() => tryEdit(roundaboutDemo)}>
        Roundabout demo
      </button>
      <p className="muted small">Saves the current map, then a copy with its central traffic lights swapped for a roundabout.</p>
    </div>
  );
}

export function roundaboutDemo() {
  const app = useApp.getState();
  const original = app.network;
  const target = centralSignal(original);
  if (!target) {
    flash('This map has no traffic lights to swap for a roundabout.');
    return;
  }
  const where = nodeLabel(original, target.id);
  const converted = setNodeKind(original, target.id, 'roundabout');

  const a = app.saveScenario(DEMO_A, `Four-way signal at ${where}`);
  useApp.setState({ network: converted });
  const b = useApp.getState().saveScenario(DEMO_B, `${where} converted to a roundabout`);
  useApp.setState({ network: original, compareIds: [a.id, b.id], compareOpen: true });
  flash('Demo pair saved. The map itself is unchanged.');
}
