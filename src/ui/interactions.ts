// What a click on the map does in each tool.

import { useApp } from '../app/store';
import {
  addRoad,
  edgeLabel,
  nodeLabel,
  setBikeLane,
  setBusLanes,
  setEdgeClosed,
  setNodeKind,
  setOneWay,
  setPedCrossing,
  setPedPhase,
  setTwoWay,
} from '../net';
import { commitEdit, flash, tryEdit } from './uiStore';
import { toMps } from './format';

const NEW_ROAD_KMH = 50;

export function pickEdge(id: string) {
  const app = useApp.getState();
  const net = app.network;
  const e = net.edges.find((x) => x.id === id);
  if (!e) return;
  const label = edgeLabel(net, id);
  const selectIt = () => useApp.getState().select({ kind: 'edge', id });

  tryEdit(() => {
    switch (app.tool) {
      case 'close':
        commitEdit(setEdgeClosed(net, id, !e.closed, true), `${e.closed ? 'Reopened' : 'Closed'} ${label}`);
        selectIt();
        break;
      case 'oneWay':
        if (e.pairId) commitEdit(setOneWay(net, id), `Made ${label} one-way`);
        else commitEdit(setTwoWay(net, id), `Made ${label} two-way`);
        selectIt();
        break;
      case 'busLane':
        if (e.busLanes > 0) {
          commitEdit(setBusLanes(net, id, 0), `Removed bus lane on ${label}`);
        } else if (e.lanes < 2) {
          flash(`${label} has 1 lane. A bus lane needs at least 2: add a lane first (L).`);
        } else {
          commitEdit(setBusLanes(net, id, 1), `Added bus lane on ${label}`);
        }
        selectIt();
        break;
      case 'bikeLane':
        commitEdit(setBikeLane(net, id, !e.bikeLane, true), `${e.bikeLane ? 'Removed' : 'Added'} bike lane on ${label}`);
        selectIt();
        break;
      case 'signal':
      case 'roundabout':
      case 'ped':
      case 'newRoad':
        flash('This tool works on junctions. Click a junction dot.');
        break;
      default:
        selectIt();
    }
  });
}

export function pickNode(id: string) {
  const app = useApp.getState();
  const net = app.network;
  const n = net.nodes.find((x) => x.id === id);
  if (!n) return;
  const label = nodeLabel(net, id);
  const selectIt = () => useApp.getState().select({ kind: 'node', id });

  tryEdit(() => {
    switch (app.tool) {
      case 'newRoad': {
        const from = app.pendingNode;
        if (!from) {
          app.setPendingNode(id);
          flash(`Start: ${label}. Now click the end junction.`);
          return;
        }
        if (from === id) {
          app.setPendingNode(null);
          flash('New road cancelled.');
          return;
        }
        const res = addRoad(net, from, id, { twoWay: true, lanes: 1, speedLimit: toMps(NEW_ROAD_KMH) });
        commitEdit(res.network, `Added road ${nodeLabel(net, from)} to ${label}`);
        useApp.getState().setPendingNode(null);
        if (res.edgeIds[0]) useApp.getState().select({ kind: 'edge', id: res.edgeIds[0] });
        return;
      }
      case 'roundabout': {
        if (n.kind === 'boundary') {
          flash('Boundary nodes are where trips enter and leave. Pick an interior junction.');
          return;
        }
        const next = n.kind === 'roundabout' ? 'signal' : 'roundabout';
        commitEdit(
          setNodeKind(net, id, next),
          next === 'roundabout' ? `Converted ${label} to a roundabout` : `Converted ${label} back to a signal`,
        );
        selectIt();
        return;
      }
      case 'ped': {
        if (n.kind === 'boundary') {
          flash('Crossings go on interior junctions.');
          return;
        }
        const on = !n.pedCrossing;
        let next = setPedCrossing(net, id, on);
        if (n.kind === 'signal') next = setPedPhase(next, id, on ? 12 : 0);
        commitEdit(next, `${on ? 'Added' : 'Removed'} pedestrian crossing at ${label}`);
        selectIt();
        return;
      }
      case 'inspect':
      case 'signal':
        selectIt();
        return;
      default:
        flash('This tool works on roads. Click a road segment.');
    }
  });
}

export function pickNone() {
  const app = useApp.getState();
  if (app.tool === 'newRoad' && app.pendingNode) return; // keep the start point while aiming
  app.select(null);
}
