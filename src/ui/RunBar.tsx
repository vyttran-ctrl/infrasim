import { useApp } from '../app/store';
import type { DemandPresetId } from '../sim/types';
import { ConfigPopover } from './ConfigPopover';
import { Segmented } from './controls';
import { clock } from './format';
import { IconPause, IconPlay, IconReset } from './icons';
import { restart, toggleRun } from './session';
import { useUI } from './uiStore';

export const SPEEDS = [1, 5, 20] as const;

export const TRAFFIC: { value: DemandPresetId; label: string }[] = [
  { value: 'low', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'rush', label: 'Rush hour' },
  { value: 'event', label: 'Event' },
];
export const trafficLabel = (id: DemandPresetId) => TRAFFIC.find((t) => t.value === id)?.label ?? id;

export function RunBar() {
  const status = useApp((s) => s.status);
  const speed = useApp((s) => s.speed);
  const simTime = useApp((s) => s.simTime);
  const duration = useApp((s) => s.config.duration);
  const demand = useApp((s) => s.config.demand);
  const popover = useUI((s) => s.popover);
  const progress = duration > 0 ? Math.min(1, simTime / duration) : 0;
  const running = status === 'running';
  const finished = status === 'finished';

  return (
    <div className="runbar-wrap">
      {popover === 'config' && <ConfigPopover />}
      <div className="runbar panel" role="toolbar" aria-label="Run controls">
        <button type="button" className="btn btn-primary btn-run" onClick={toggleRun}>
          {running ? <IconPause /> : <IconPlay />}
          {running ? 'Pause' : finished ? 'Play again' : 'Play'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={restart} aria-label="Restart from minute zero">
          <IconReset />
          <span className="hide-narrow">Restart</span>
        </button>

        <Segmented<number>
          label="Simulation speed"
          size="sm"
          value={speed}
          onChange={(v) => useApp.getState().setSpeed(v)}
          options={SPEEDS.map((v) => ({ value: v, label: `${v}×`, title: `${v} times real speed` }))}
        />

        <label className="traffic">
          <span className="caps">Traffic</span>
          <select
            className="select"
            value={demand}
            onChange={(e) => {
              useApp.getState().setConfig({ demand: e.target.value as DemandPresetId });
              useApp.getState().start();
            }}
          >
            {TRAFFIC.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div className="run-clock" aria-label={`${clock(simTime)} of ${clock(duration)} simulated`}>
          <span className="mono">
            {clock(simTime)}
            <span className="muted"> / {clock(duration)}</span>
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        </div>

        <button
          type="button"
          className="link advanced"
          aria-expanded={popover === 'config'}
          onClick={() => useUI.getState().setPopover(popover === 'config' ? null : 'config')}
        >
          Advanced
        </button>
      </div>
    </div>
  );
}
