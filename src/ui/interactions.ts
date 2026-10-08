// What a click on the map does. No modes: a click selects, and the card that
// opens offers the changes. The one exception is picking the far end of a
// new road, which takes over the next junction click.

import { useApp } from '../app/store';
import { addRoad, nodeLabel } from '../net';
import { toMps } from './format';
import { closeResults } from './testRun';
import { commitEdit, flash, tryEdit } from './uiStore';

const NEW_ROAD_KMH = 50;

export function isPickingRoadEnd() {
  const s = useApp.getState();
  return s.tool === 'newRoad' && !!s.pendingNode;
}

/** Start drawing a new road from a junction; the next junction click finishes it. */
export function beginNewRoad(fromNodeId: string) {
  useApp.setState({ tool: 'newRoad', pendingNode: fromNodeId });
}

export function cancelNewRoad() {
  useApp.setState({ tool: 'inspect', pendingNode: null });
}

export function pickEdge(id: string) {
  if (isPickingRoadEnd()) {
    flash('Click a junction (where roads meet) to finish the new road.');
    return;
  }
  closeResults();
  useApp.getState().select({ kind: 'edge', id });
}

export function pickNode(id: string) {
  const app = useApp.getState();
  if (!isPickingRoadEnd()) {
    closeResults();
    app.select({ kind: 'node', id });
    return;
  }
  const from = app.pendingNode!;
  if (from === id) {
    flash('Pick a different junction for the other end.');
    return;
  }
  const net = app.network;
  tryEdit(() => {
    const res = addRoad(net, from, id, { twoWay: true, lanes: 1, speedLimit: toMps(NEW_ROAD_KMH) });
    cancelNewRoad();
    if (res.edgeIds.length === 0) {
      flash('Those two junctions could not be joined.');
      return;
    }
    commitEdit(res.network, `Built a new road from ${nodeLabel(net, from)} to ${nodeLabel(net, id)}`);
    useApp.getState().select({ kind: 'edge', id: res.edgeIds[0] });
  });
}

export function pickNone() {
  if (isPickingRoadEnd()) return; // keep aiming; Cancel or Esc stops
  useApp.getState().select(null);
}
