import { useApp } from '../app/store';
import { nodeLabel } from '../net';
import { toolIcons } from './icons';
import { TOOL_META, TOOLS } from './tools';
import { useUI } from './uiStore';

export function ToolRail() {
  const tool = useApp((s) => s.tool);
  return (
    <nav className="rail" aria-label="Tools">
      {TOOLS.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={`rail-btn${i === 1 || i === 5 ? ' rail-group' : ''}`}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key}): ${t.hint}`}
          onClick={() => useApp.getState().setTool(t.id)}
        >
          {toolIcons[t.id]}
          <span className="rail-label">{t.label}</span>
          <kbd className="rail-key">{t.key}</kbd>
        </button>
      ))}
    </nav>
  );
}

/** One line telling what a click does now; also carries transient messages. */
export function MapHint() {
  const tool = useApp((s) => s.tool);
  const pending = useApp((s) => s.pendingNode);
  const network = useApp((s) => s.network);
  const message = useUI((s) => s.flash);
  const meta = TOOL_META[tool];
  const text =
    message ??
    (tool === 'newRoad' && pending ? `From ${nodeLabel(network, pending)}: click the end junction. Esc cancels.` : meta.hint);
  return (
    <div className={`map-hint${message ? ' is-flash' : ''}`} role="status" aria-live="polite">
      <span className="caps map-hint-tool">{meta.label}</span>
      <span>{text}</span>
    </div>
  );
}
