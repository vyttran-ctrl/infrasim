// The three-step guide across the top of the map. It moves on by itself:
// selecting something is step 2, making a change unlocks step 3.

import { useApp } from '../app/store';
import { IconCheck } from './icons';
import { runTest, tryExample, useTest } from './testRun';

export function StepStrip() {
  const edits = useApp((s) => s.edits.length);
  const selecting = useApp((s) => s.selection !== null);
  const test = useTest();
  const testing = test.status === 'running';
  const tested = test.status === 'done' && test.edits.length === edits;
  const current = edits > 0 ? 3 : selecting ? 2 : 1;

  const step = (n: number, text: string) => {
    const state = n < current ? 'done' : n === current ? 'current' : 'next';
    return (
      <li className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="step-num mono" aria-hidden="true">
          {state === 'done' ? <IconCheck /> : n}
        </span>
        <span className="step-text">{text}</span>
      </li>
    );
  };

  return (
    <div className="steps-wrap">
      <nav className="steps panel" aria-label="How it works">
        <ol>
          {step(1, 'Watch traffic')}
          {step(2, 'Change the map')}
        </ol>
        <button
          type="button"
          className={`btn btn-test${current === 3 ? ' btn-primary' : ' btn-secondary'}`}
          disabled={edits === 0 || testing}
          onClick={() => void runTest()}
          title={edits === 0 ? 'Change something on the map first' : undefined}
        >
          <span className="step-num mono" aria-hidden="true">
            3
          </span>
          {testing ? `Testing… ${Math.round(test.progress * 100)}%` : tested ? 'Test again' : 'Test my changes'}
        </button>
        {testing && (
          <span className="progress steps-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${test.progress})` }} />
          </span>
        )}
      </nav>
      {edits === 0 && !selecting && test.status === 'idle' && (
        <div className="steps-hint panel">
          <span>Click any road or junction to change it.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={tryExample}>
            Try an example
          </button>
        </div>
      )}
    </div>
  );
}
