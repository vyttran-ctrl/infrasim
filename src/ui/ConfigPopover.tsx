import { useState } from 'react';
import { useApp } from '../app/store';
import { DEMAND_PRESETS } from '../sim/demand';
import type { DemandPresetId, SimConfig } from '../sim/types';
import { NumberInput, Segmented } from './controls';
import { num } from './format';
import { IconClose, IconDice } from './icons';
import { useUI } from './uiStore';

const PRESET_ORDER: DemandPresetId[] = ['low', 'normal', 'rush', 'event'];

export function ConfigPopover() {
  const config = useApp((s) => s.config);
  const inProgress = useApp((s) => s.simTime > 0 && s.status !== 'idle');
  const [draft, setDraft] = useState<SimConfig>(config);
  const dirty = (Object.keys(draft) as (keyof SimConfig)[]).some((k) => draft[k] !== config[k]);

  const change = (patch: Partial<SimConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    // Nothing to lose: apply straight away. Otherwise hold until confirmed.
    if (!inProgress) useApp.getState().setConfig(patch);
  };
  const apply = () => useApp.getState().setConfig(draft);
  const effectiveRate = draft.spawnRate * (DEMAND_PRESETS[draft.demand]?.rateFactor ?? 1);

  return (
    <div className="popover panel config" role="dialog" aria-label="Run settings">
      <div className="popover-head">
        <h2 className="caps popover-title">Run settings</h2>
        <button type="button" className="icon-btn" aria-label="Close settings" onClick={() => useUI.getState().setPopover(null)}>
          <IconClose />
        </button>
      </div>

      <div className="config-grid">
        <label className="cfg-label caps" htmlFor="cfg-veh">
          Vehicles
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
          <span className="unit">veh max</span>
        </span>

        <label className="cfg-label caps" htmlFor="cfg-dur">
          Duration
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

        <span className="cfg-label caps">Demand</span>
        <div className="cfg-span">
          <Segmented<DemandPresetId>
            label="Demand preset"
            size="sm"
            value={draft.demand}
            onChange={(demand) => change({ demand })}
            options={PRESET_ORDER.filter((id) => DEMAND_PRESETS[id]).map((id) => ({
              value: id,
              label: DEMAND_PRESETS[id].label,
              title: `${DEMAND_PRESETS[id].label}: ${num(DEMAND_PRESETS[id].rateFactor, 2)}× spawn rate`,
            }))}
          />
        </div>

        <label className="cfg-label caps" htmlFor="cfg-rate">
          Spawn rate
        </label>
        <span className="input-unit">
          <NumberInput id="cfg-rate" value={draft.spawnRate} min={300} max={12000} step={100} onCommit={(v) => change({ spawnRate: v })} />
          <span className="unit">veh/h</span>
        </span>
        <span className="cfg-val mono muted" title="Spawn rate × demand preset factor">
          {num(effectiveRate)}
          <span className="unit">veh/h eff.</span>
        </span>

        <label className="cfg-label caps" htmlFor="cfg-seed">
          Seed
        </label>
        <span className="seed">
          <NumberInput id="cfg-seed" value={draft.seed} min={0} max={999999} onCommit={(v) => change({ seed: Math.round(v) })} />
          <button
            type="button"
            className="icon-btn"
            title="Re-roll seed"
            aria-label="Re-roll seed"
            onClick={() => change({ seed: Math.floor(Math.random() * 99999) + 1 })}
          >
            <IconDice />
          </button>
        </span>
        <span />
      </div>
      <p className="config-note">Same seed = same trips. Change only infrastructure for a fair comparison.</p>

      {inProgress && dirty && (
        <div className="confirm-strip" role="alert">
          <span>Applying these settings resets the current run.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(config)}>
            Discard
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
            Apply and reset
          </button>
        </div>
      )}
    </div>
  );
}
