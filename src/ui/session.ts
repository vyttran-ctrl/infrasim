// Loading maps and driving the live run. Every load starts traffic straight
// away so the first thing a visitor sees is moving cars.

import { useApp, type NetworkSource } from '../app/store';
import { buildGrid, loadWaterloo } from '../net';
import { requestCameraReset } from '../render';
import type { RoadNetwork } from '../sim/types';
import { clearTest } from './testRun';
import { flash, useUI } from './uiStore';

export function loadAndRun(net: RoadNetwork, source: NetworkSource) {
  const app = useApp.getState();
  clearTest();
  app.loadNetwork(net, source);
  app.setSpeed(app.speed);
  app.start();
  requestCameraReset();
}

let loadToken = 0;

export async function loadMap(source: Exclude<NetworkSource, 'osm'>) {
  const token = ++loadToken;
  useUI.setState({ importOpen: false, menuOpen: false });
  if (source === 'grid') {
    useUI.setState({ loading: null });
    loadAndRun(buildGrid(), 'grid');
    return;
  }
  useUI.setState({ loading: 'Loading the Waterloo map…' });
  if (useApp.getState().network.nodes.length === 0) useApp.setState({ source: 'waterloo' });
  try {
    const net = await loadWaterloo();
    if (token !== loadToken) return;
    loadAndRun(net, 'waterloo');
  } catch (e) {
    if (token !== loadToken) return;
    // Fall back to something that always works.
    if (useApp.getState().network.nodes.length === 0) loadAndRun(buildGrid(), 'grid');
    flash(e instanceof Error ? `Could not load Waterloo: ${e.message}` : 'Could not load the Waterloo map.');
  } finally {
    if (token === loadToken) useUI.setState({ loading: null });
  }
}

export function toggleRun() {
  const s = useApp.getState();
  if (s.status === 'running') s.pause();
  else if (s.status === 'finished') restart();
  else s.start();
}

/** Back to minute zero with the current map, and play. */
export function restart() {
  const s = useApp.getState();
  s.reset();
  s.start();
}

/** Throw away every change and reload the map as it was first loaded. */
export function startOver() {
  const { originalNetwork, source } = useApp.getState();
  if (!originalNetwork) return;
  loadAndRun(originalNetwork, source);
  flash('Back to the original map.');
}
