import { useState } from 'react';
import { useApp } from '../app/store';
import { flash } from './uiStore';

export function SaveScenarioForm({ onDone, autoFocus }: { onDone?(): void; autoFocus?: boolean }) {
  const count = useApp((s) => s.scenarios.length);
  const edits = useApp((s) => s.edits.length);
  const [name, setName] = useState(() => (count === 0 && edits === 0 ? 'Baseline' : `Scenario ${count + 1}`));
  const [note, setNote] = useState('');

  return (
    <form
      className="save-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        useApp.getState().saveScenario(n, note.trim() || undefined);
        flash(`Saved "${n}" and ticked it for comparison.`);
        setName(`Scenario ${count + 2}`);
        setNote('');
        onDone?.();
      }}
    >
      <label className="field-stack">
        <span className="caps">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={autoFocus} maxLength={60} required />
      </label>
      <label className="field-stack">
        <span className="caps">Note</span>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={edits ? 'What changed and why' : 'Existing conditions'}
          maxLength={140}
        />
      </label>
      <div className="save-actions">
        <span className="muted small">
          Saves the network{edits ? ` (${edits} edit${edits > 1 ? 's' : ''})` : ''} and run settings.
        </span>
        {onDone && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
          Save scenario
        </button>
      </div>
    </form>
  );
}
