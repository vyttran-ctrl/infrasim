import { useRef, useState } from 'react';
import { useApp, type NetworkSource } from '../app/store';
import { buildGrid, importOverpass, loadWaterloo, WATERLOO_BBOX, type BBox } from '../net';
import { requestCameraReset } from '../render';
import type { RoadNetwork } from '../sim/types';
import { IconCompare } from './icons';
import { useUI } from './uiStore';

type Loading = NetworkSource | null;

export function TopBar() {
  const network = useApp((s) => s.network);
  const source = useApp((s) => s.source);
  const compareCount = useApp((s) => s.compareIds.length);
  const compareOpen = useApp((s) => s.compareOpen);
  const importOpen = useUI((s) => s.importOpen);
  const sheetOpen = useUI((s) => s.sheetOpen);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (net: RoadNetwork, src: NetworkSource) => {
    useApp.getState().loadNetwork(net, src);
    requestCameraReset();
  };

  const pickGrid = () => {
    setError(null);
    useUI.getState().setImportOpen(false);
    load(buildGrid(), 'grid');
  };
  const pickWaterloo = async () => {
    setError(null);
    useUI.getState().setImportOpen(false);
    setLoading('waterloo');
    try {
      load(await loadWaterloo(), 'waterloo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Waterloo network.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-cell wordmark" aria-label="InfraSim">
        Infra<span>Sim</span>
      </div>

      <div className="topbar-cell net-picker" role="group" aria-label="Network">
        <span className="caps topbar-label">Network</span>
        <div className="seg seg-sm">
          <button type="button" className="seg-btn" aria-pressed={source === 'grid'} onClick={pickGrid} disabled={loading !== null}>
            Grid city
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={source === 'waterloo'}
            onClick={pickWaterloo}
            disabled={loading !== null}
            aria-busy={loading === 'waterloo'}
          >
            {loading === 'waterloo' ? 'Loading Waterloo…' : 'Waterloo (OSM)'}
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={source === 'osm' || importOpen}
            aria-expanded={importOpen}
            onClick={() => {
              setError(null);
              useUI.getState().setImportOpen(!importOpen);
            }}
            disabled={loading === 'waterloo'}
          >
            Import OSM area…
          </button>
        </div>
      </div>

      <div className="topbar-cell net-name">
        <span className="caps topbar-label">Sheet</span>
        <span className="net-title" title={network.name}>
          {network.name}
        </span>
        <span className="net-meta mono">
          {network.nodes.length} nodes · {network.edges.length} links
        </span>
        {network.attribution && <span className="net-attr">{network.attribution}</span>}
      </div>

      {error && !importOpen && (
        <div className="topbar-cell topbar-error" role="alert">
          {error}
        </div>
      )}

      <div className="topbar-spacer" />

      <button
        type="button"
        className="btn btn-ghost sheet-toggle"
        aria-expanded={sheetOpen}
        onClick={() => useUI.getState().setSheetOpen(!sheetOpen)}
      >
        Metrics
      </button>

      <button
        type="button"
        className={`btn ${compareOpen ? 'btn-primary' : 'btn-secondary'} compare-btn`}
        onClick={() => useApp.getState().setCompareOpen(!compareOpen)}
        aria-expanded={compareOpen}
        title="Compare saved scenarios"
      >
        <IconCompare />
        Compare
        <span className="count mono" aria-label={`${compareCount} scenarios ticked`}>
          {compareCount}
        </span>
      </button>

      {importOpen && <ImportForm onLoaded={(net) => load(net, 'osm')} />}
    </header>
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
      className="import-form panel"
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
      aria-label="Import OSM area"
    >
      <div className="import-head">
        <h2 className="caps">Import OSM area</h2>
        <p className="muted">Bounding box in decimal degrees. Roads are fetched from OpenStreetMap via Overpass. Keep the area under about 2 × 2 km.</p>
      </div>
      <div className="import-fields">
        {fields.map((f) => (
          <label key={f.key} className="field-inline">
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
      {!valid && <p className="msg msg-bad">North must be above south and east must be right of west.</p>}
      {error && (
        <p className="msg msg-bad" role="alert">
          {error}
        </p>
      )}
      <div className="import-actions">
        {busy ? (
          <>
            <span className="muted" aria-live="polite">
              Fetching roads from Overpass…
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
