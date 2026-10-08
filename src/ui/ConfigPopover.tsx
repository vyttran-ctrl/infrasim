import { useState } from 'react';
import { useApp } from '../app/store';
import { DEMAND_PRESETS } from '../sim/demand';
import type { SimConfig } from '../sim/types';
import { NumberInput } from './controls';
import { num } from './format';
import { IconClose, IconDice } from './icons';
import { useUI } from './uiStore';

export function ConfigPopover() {
  const config = useApp((s) => s.config);
  const inProgress = useApp((s) => s.simTime > 0 && s.status !== 'idle');
  const [draft, setDraft] = useState<SimConfig>(config);
  const dirty = (Object.keys(draft) as (keyof SimConfig)[]).some((k) => draft[k] !== config[k]);

  const change = (patch: Partial<SimConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Nothing to lose: apply straight away. Otherwise hold until confirmed.
    if (!inProgress) {
      useApp.getState().setConfig(patch);
      useApp.getState().start();
    }
  };
  const apply = () => {
    useApp.getState().setConfig(draft);
    useApp.getState().start();
  };
  const effectiveRate = draft.spawnRate * (DEMAND_PRESETS[draft.demand]?.rateFactor ?? 1);

  return (
    <div className="popover panel config" role="dialog" aria-label="Advanced settings">
      <div className="popover-head">
        <h2 className="caps popover-title">Advanced settings</h2>
        <button type="button" className="icon-btn" aria-label="Close settings" onClick={() => useUI.getState().setPopover(null)}>
          <IconClose />
        </button>
      </div>

      <div className="config-grid">
        <label className="cfg-label" htmlFor="cfg-veh">
          Most cars at once
        </label>
        <input
          id="cfg-veh"
          className="range"
          type="range"
          min={100}
          max={1000}
          step={50}
          value={draft.maxVehicles}
          onChange={(e) => change({ maxVehicles: Number(e.target.value) })}
        />
        <span className="cfg-val mono">
          {num(draft.maxVehicles)}
          <span className="unit">cars</span>
        </span>

        <label className="cfg-label" htmlFor="cfg-dur">
          Length of run
        </label>
        <input
          id="cfg-dur"
          className="range"
          type="range"
          min={5}
          max={60}
          step={5}
          value={draft.duration / 60}
          onChange={(e) => change({ duration: Number(e.target.value) * 60 })}
        />
        <span className="cfg-val mono">
          {num(draft.duration / 60)}
          <span className="unit">min</span>
        </span>

        <label className="cfg-label" htmlFor="cfg-rate">
          New cars per hour
        </label>
        <span className="input-unit">
          <NumberInput id="cfg-rate" value={draft.spawnRate} min={300} max={12000} step={100} onCommit={(v) => change({ spawnRate: v })} />
          <span className="unit">cars/h</span>
        </span>
        <span className="cfg-val mono muted" title="After the Traffic setting is applied">
          {num(effectiveRate)}
          <span className="unit">cars/h now</span>
        </span>

        <label className="cfg-label" htmlFor="cfg-seed">
          Random seed
        </label>
        <span className="seed">
          <NumberInput id="cfg-seed" value={draft.seed} min={0} max={999999} onCommit={(v) => change({ seed: Math.round(v) })} />
          <button
            type="button"
            className="icon-btn"
            title="Pick a new seed"
            aria-label="Pick a new seed"
            onClick={() => change({ seed: Math.floor(Math.random() * 99999) + 1 })}
          >
            <IconDice />
          </button>
        </span>
        <span />
      </div>
      <p className="config-note">The same seed gives the same trips, so Test my changes always compares like with like.</p>

      {inProgress && dirty && (
        <div className="confirm-strip" role="alert">
          <span>Applying these settings restarts the run.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(config)}>
            Discard
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
            Apply and restart
          </button>
        </div>
      )}
    </div>
  );
}
