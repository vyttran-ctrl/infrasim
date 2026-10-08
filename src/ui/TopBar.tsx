import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { importOverpass, WATERLOO_BBOX, type BBox } from '../net';
import type { RoadNetwork } from '../sim/types';
import { roundaboutDemo } from './CompareDrawer';
import { IconChevron, IconClose } from './icons';
import { loadAndRun, loadMap } from './session';
import { tryEdit, useUI } from './uiStore';

export function TopBar() {
  const network = useApp((s) => s.network);
  const source = useApp((s) => s.source);
  const importOpen = useUI((s) => s.importOpen);
  const popover = useUI((s) => s.popover);
  const loading = useUI((s) => s.loading);

  return (
    <header className="topbar">
      <div className="wordmark" aria-label="InfraSim">
        Infra<span>Sim</span>
      </div>

      <label className="map-picker">
        <span className="caps">Map</span>
        <select
          className="select"
          value={source}
          disabled={!!loading}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'grid' || v === 'waterloo') void loadMap(v);
          }}
        >
          <option value="waterloo">Waterloo (real map)</option>
          <option value="grid">Simple grid</option>
          {source === 'osm' && <option value="osm">{network.name}</option>}
        </select>
      </label>

      {network.attribution && <span className="attribution">{network.attribution}</span>}

      <div className="topbar-spacer" />
      <MoreMenu />

      {importOpen && <ImportForm onLoaded={(net) => loadAndRun(net, 'osm')} />}
      {popover === 'shortcuts' && <Shortcuts />}
    </header>
  );
}

function MoreMenu() {
  const open = useUI((s) => s.menuOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) useUI.getState().setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const item = (label: string, onClick: () => void) => (
    <button type="button" role="menuitem" className="menu-item" onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="more-menu" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => useUI.getState().setMenuOpen(!open)}
      >
        More
        <IconChevron up={open} />
      </button>
      {open && (
        <div className="menu panel" role="menu">
          {item('Import another area…', () => useUI.getState().setImportOpen(true))}
          {item('Scenarios…', () => {
            useUI.getState().setMenuOpen(false);
            useApp.getState().setCompareOpen(true);
          })}
          {item('Roundabout demo', () => {
            useUI.getState().setMenuOpen(false);
            tryEdit(roundaboutDemo);
          })}
          {item('Keyboard shortcuts', () => useUI.getState().setPopover('shortcuts'))}
        </div>
      )}
    </div>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['Space', 'Play or pause'],
    ['R', 'Restart from minute zero'],
    ['Ctrl + Z', 'Undo the last change'],
    ['Esc', 'Close the card or menu'],
  ];
  return (
    <div className="topbar-pop panel" role="dialog" aria-label="Keyboard shortcuts">
      <div className="popover-head">
        <h2 className="caps popover-title">Keyboard shortcuts</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => useUI.getState().setPopover(null)}>
          <IconClose />
        </button>
      </div>
      <dl className="shortcuts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ImportForm({ onLoaded }: { onLoaded(net: RoadNetwork): void }) {
  const [bbox, setBbox] = useState<BBox>({ ...WATERLOO_BBOX });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const fields: { key: keyof BBox; label: string }[] = [
    { key: 'south', label: 'South' },
    { key: 'west', label: 'West' },
    { key: 'north', label: 'North' },
    { key: 'east', label: 'East' },
  ];
  const valid = bbox.north > bbox.south && bbox.east > bbox.west;

  const run = async () => {
    if (!valid) return;
    setError(null);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const net = await importOverpass(bbox, abort.current.signal);
      onLoaded(net);
      useUI.getState().setImportOpen(false);
    } catch (e) {
      if (abort.current?.signal.aborted) setError('Import cancelled.');
      else setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <form
      className="topbar-pop import-form panel"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
      aria-label="Import another area"
    >
      <div className="import-head">
        <h2 className="caps popover-title">Import another area</h2>
        <p className="muted small">
          Type the edges of the area in decimal degrees (latitude and longitude). Roads come from OpenStreetMap. Keep it under about 2 × 2 km.
        </p>
      </div>
      <div className="import-fields">
        {fields.map((f) => (
          <label key={f.key} className="field-stack">
            <span className="caps">{f.label}</span>
            <input
              className="input mono"
              type="number"
              step="0.0001"
              value={bbox[f.key]}
              disabled={busy}
              onChange={(e) => setBbox({ ...bbox, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      {!valid && <p className="msg msg-bad">North must be above south, and east must be right of west.</p>}
      {error && (
        <p className="msg msg-bad" role="alert">
          {error}
        </p>
      )}
      <div className="import-actions">
        {busy ? (
          <>
            <span className="muted" aria-live="polite">
              Fetching roads…
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setBbox({ ...WATERLOO_BBOX })}>
              Reset to Waterloo
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => useUI.getState().setImportOpen(false)}>
              Close
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              Import
            </button>
          </>
        )}
      </div>
    </form>
  );
}
