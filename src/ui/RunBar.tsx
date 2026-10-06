import { useApp } from '../app/store';
import { CoachCard } from './CoachCard';
import { ConfigPopover } from './ConfigPopover';
import { Segmented } from './controls';
import { clock } from './format';
import { IconPause, IconPlay, IconReset, IconSliders } from './icons';
import { SaveScenarioForm } from './SaveScenarioForm';
import { SPEEDS } from './tools';
import { useUI } from './uiStore';

export function toggleRun() {
  const s = useApp.getState();
  if (s.status === 'running') s.pause();
  else if (s.status !== 'finished') s.start();
}

export function RunBar() {
  const status = useApp((s) => s.status);
  const speed = useApp((s) => s.speed);
  const simTime = useApp((s) => s.simTime);
  const duration = useApp((s) => s.config.duration);
  const fresh = useApp((s) => s.status === 'idle' && s.simTime === 0 && !s.metrics?.spawned);
  const popover = useUI((s) => s.popover);
  const progress = duration > 0 ? Math.min(1, simTime / duration) : 0;
  const running = status === 'running';
  const finished = status === 'finished';

  return (
    <div className="runbar-wrap">
      {popover === 'config' && <ConfigPopover />}
      {popover === 'save' && (
        <div className="popover panel" role="dialog" aria-label="Save as scenario">
          <h2 className="caps popover-title">Save as scenario</h2>
          <SaveScenarioForm autoFocus onDone={() => useUI.getState().setPopover(null)} />
        </div>
      )}
      {fresh && !popover && <CoachCard />}

      <div className={`runbar panel${fresh ? ' is-fresh' : ''}`} role="toolbar" aria-label="Run controls">
        {finished ? (
          <div className="run-done">
            <span className="run-done-dot" aria-hidden="true" />
            <span>Run complete</span>
            <button type="button" className="btn btn-primary" onClick={() => useUI.getState().setPopover(popover === 'save' ? null : 'save')}>
              Save as scenario
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`btn btn-primary btn-run${fresh ? ' is-emph' : ''}`}
            onClick={toggleRun}
            title={running ? 'Pause (Space)' : 'Start (Space)'}
          >
            {running ? <IconPause /> : <IconPlay />}
            {running ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => useApp.getState().reset()}
          disabled={fresh}
          title="Reset run (R)"
        >
          <IconReset />
          Reset
        </button>

        <Segmented<number>
          label="Simulation speed"
          size="sm"
          value={speed}
          onChange={(v) => useApp.getState().setSpeed(v)}
          options={SPEEDS.map((v, i) => ({ value: v, label: `${v}×`, title: `${v}× speed (${i + 1})` }))}
        />

        <div className="run-clock" aria-label={`Simulated time ${clock(simTime)} of ${clock(duration)}`}>
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
          className="btn btn-ghost"
          aria-expanded={popover === 'config'}
          onClick={() => useUI.getState().setPopover(popover === 'config' ? null : 'config')}
          title="Demand and run settings"
        >
          <IconSliders />
          Settings
        </button>
      </div>
    </div>
  );
}
