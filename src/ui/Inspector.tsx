import { useApp } from '../app/store';
import { requestFocus } from '../render';
import { EdgeInspector } from './EdgeInspector';
import { IconClose, IconTarget } from './icons';
import { NodeInspector } from './NodeInspector';

export function Inspector() {
  const selection = useApp((s) => s.selection);
  const network = useApp((s) => s.network);
  if (!selection) return null;

  const edge = selection.kind === 'edge' ? network.edges.find((e) => e.id === selection.id) : undefined;
  const node = selection.kind === 'node' ? network.nodes.find((n) => n.id === selection.id) : undefined;
  if (!edge && !node) return null;

  return (
    <aside className="inspector panel" aria-label="Inspector">
      <div className="inspector-tools">
        <span className="caps muted">{edge ? 'Road link' : 'Junction'}</span>
        <span className="inspector-id mono muted">{selection.id}</span>
        <button type="button" className="icon-btn" title="Centre view on selection" aria-label="Centre view on selection" onClick={() => requestFocus(selection)}>
          <IconTarget />
        </button>
        <button type="button" className="icon-btn" title="Close inspector (Esc)" aria-label="Close inspector" onClick={() => useApp.getState().select(null)}>
          <IconClose />
        </button>
      </div>
      {edge && <EdgeInspector key={edge.id} edge={edge} />}
      {node && <NodeInspector key={node.id} node={node} />}
    </aside>
  );
}
