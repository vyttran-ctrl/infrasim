import { useApp } from '../app/store';
import { IconUndo } from './icons';
import { undoLastEdit, useUI } from './uiStore';

/** One line near the bottom: what just happened, with Undo after an edit. */
export function Toast() {
  const toast = useUI((s) => s.toast);
  const canUndo = useUI((s) => s.undo.length > 0);
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast panel" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.undo && canUndo && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={undoLastEdit}
        >
          <IconUndo />
          Undo
        </button>
      )}
    </div>
  );
}

/** Shown while the first map loads, before any traffic exists. */
export function Loading() {
  const loading = useUI((s) => s.loading);
  const empty = useApp((s) => s.network.nodes.length === 0);
  if (!loading && !empty) return null;
  return (
    <div className="loading" role="status">
      <span className="loading-bar progress" aria-hidden="true">
        <span />
      </span>
      {loading ?? 'Loading…'}
    </div>
  );
}
