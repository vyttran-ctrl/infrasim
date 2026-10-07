import { useMemo } from 'react';
import { useApp } from '../app/store';
import { checkConnectivity } from '../net';
import { IconUndo } from './icons';
import { undoLastEdit, useUI } from './uiStore';

export function ConnectivityWarning() {
  const network = useApp((s) => s.network);
  const canUndo = useUI((s) => s.undo.length > 0);
  const result = useMemo(() => {
    try {
      return checkConnectivity(network);
    } catch {
      return { ok: true, unreachable: [] };
    }
  }, [network]);

  if (result.ok || result.unreachable.length === 0) return null;
  const first = result.unreachable[0];
  const more = result.unreachable.length - 1;
  return (
    <div className="conn-warning" role="alert">
      <span className="conn-mark" aria-hidden="true">
        !
      </span>
      <p>
        <strong>Network is disconnected:</strong> {first.from} → {first.to} has no route
        {more > 0 ? ` (and ${more} more zone pair${more > 1 ? 's' : ''})` : ''}. Trips between them will be dropped.
      </p>
      {canUndo && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={undoLastEdit} title="Undo last edit (Ctrl+Z)">
          <IconUndo />
          Undo last edit
        </button>
      )}
    </div>
  );
}
