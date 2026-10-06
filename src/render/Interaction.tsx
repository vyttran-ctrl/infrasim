// Invisible pick meshes, hover/selection highlights, new-road preview.

import { useEffect, useMemo } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useApp, type Selection } from '../app/store';
import { palette } from '../app/palette';
import type { RoadBuild } from './build';
import { H } from './build';
import { FlatBuf, rgb } from './buffers';
import { ORDER, flatMaterial, pickMaterial } from './materials';
import { lateralOffset, makeStrip, subPolyline } from './polyline';

export interface PickHandlers {
  onPickEdge: (edgeId: string) => void;
  onPickNode: (nodeId: string) => void;
  onPickNone: () => void;
}

const DRAG_PX = 5;

function sameSel(a: Selection, b: Selection) {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

export function Interaction({ build, handlers }: { build: RoadBuild; handlers: React.MutableRefObject<PickHandlers> }) {
  const gl = useThree((s) => s.gl);
  const pickMat = useMemo(() => pickMaterial(), []);
  useEffect(() => () => pickMat.dispose(), [pickMat]);

  const setCursor = (c: string) => {
    if (gl.domElement.style.cursor !== c) gl.domElement.style.cursor = c;
  };
  const hoverTo = (s: Selection) => {
    const st = useApp.getState();
    if (!sameSel(st.hover, s)) st.setHover(s);
    setCursor(s ? 'pointer' : '');
  };

  const edgeFromStreetHit = (e: ThreeEvent<PointerEvent | MouseEvent>): string | null => {
    if (e.faceIndex == null) return null;
    const si = build.triStreet[e.faceIndex];
    const st = build.streets[si];
    if (!st) return null;
    const a = build.byIndex[st.a];
    if (!a) return null;
    if (st.b < 0) return a.edge.id;
    const lat = lateralOffset(a.pts, e.point.x, -e.point.z);
    const b = build.byIndex[st.b];
    return lat >= 0 || !b ? a.edge.id : b.edge.id;
  };
  const nodeFromHit = (e: ThreeEvent<PointerEvent | MouseEvent>): string | null => {
    if (e.faceIndex == null) return null;
    const n = build.nodes[build.triNode[e.faceIndex]];
    return n ? n.node.id : null;
  };

  return (
    <group>
      <mesh
        geometry={build.streetPick}
        material={pickMat}
        onClick={(e) => {
          if (e.delta > DRAG_PX) return;
          e.stopPropagation();
          const id = edgeFromStreetHit(e);
          if (id) handlers.current.onPickEdge(id);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          const id = edgeFromStreetHit(e);
          hoverTo(id ? { kind: 'edge', id } : null);
        }}
      />
      <mesh
        geometry={build.nodePick}
        material={pickMat}
        onClick={(e) => {
          if (e.delta > DRAG_PX) return;
          e.stopPropagation();
          const id = nodeFromHit(e);
          if (id) handlers.current.onPickNode(id);
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          const id = nodeFromHit(e);
          hoverTo(id ? { kind: 'node', id } : null);
        }}
      />
      <Highlights build={build} />
    </group>
  );
}

function highlightGeometry(build: RoadBuild, sel: Selection, hex: string): THREE.BufferGeometry | null {
  if (!sel) return null;
  const buf = new FlatBuf();
  const c = rgb(hex);
  const h = H.highlight;
  if (sel.kind === 'edge') {
    const e = build.edgeById.get(sel.id);
    if (!e) return null;
    let s0 = e.trimA * 0.8, s1 = e.length - e.trimB * 0.8;
    if (s1 - s0 < 2) { s0 = 0; s1 = e.length; }
    const strip = makeStrip(subPolyline(e.pts, e.cum, s0, s1));
    if (!strip) return null;
    const w = 0.9;
    buf.ribbon(strip, e.inner - w / 2 + (e.edge.pairId ? w / 2 : 0), e.inner + w / 2 + (e.edge.pairId ? w / 2 : 0), h, c);
    buf.ribbon(strip, e.outer - w / 2, e.outer + w / 2, h, c);
    // end caps
    for (const s of [s0, s1]) {
      const q = Math.min(s1, s + 0.8);
      const p = Math.max(s0, q - 0.8);
      buf.ribbonRange(e.pts, e.cum, p, q, e.inner, e.outer, h, c);
    }
    // direction chevron near the downstream end
    const L = s1 - s0;
    if (L > 14) {
      const tip = s1 - 4, mid = (e.inner + e.outer) / 2, half = (e.outer - e.inner) * 0.28;
      buf.ribbonRange(e.pts, e.cum, tip - 3.5, tip, mid - half * 0.25, mid + half * 0.25, h, c);
    }
  } else {
    const n = build.nodeById.get(sel.id);
    if (!n) return null;
    const r = n.r > 0 ? n.r : 5;
    buf.ring(n.node.x, n.node.y, r + 0.3, r + 1.4, h, c, 48);
  }
  return buf.toGeometry();
}

function Highlights({ build }: { build: RoadBuild }) {
  const selection = useApp((s) => s.selection);
  const hover = useApp((s) => s.hover);
  const tool = useApp((s) => s.tool);
  const pendingNode = useApp((s) => s.pendingNode);
  const mat = useMemo(() => flatMaterial(), []);
  const hoverMat = useMemo(() => flatMaterial(0.9), []);
  useEffect(() => () => { mat.dispose(); hoverMat.dispose(); }, [mat, hoverMat]);

  const selGeo = useMemo(() => highlightGeometry(build, selection, palette.selection), [build, selection]);
  const hovGeo = useMemo(
    () => (sameSel(hover, selection) ? null : highlightGeometry(build, hover, palette.hover)),
    [build, hover, selection],
  );
  useEffect(() => () => selGeo?.dispose(), [selGeo]);
  useEffect(() => () => hovGeo?.dispose(), [hovGeo]);

  const drawing = tool === 'newRoad';
  const ringsGeo = useMemo(() => {
    if (!drawing) return null;
    const buf = new FlatBuf();
    const c = rgb(palette.accent);
    const cp = rgb(palette.selection);
    for (const n of build.nodes) {
      const r = n.r > 0 ? n.r : 5;
      if (n.node.id === pendingNode) buf.ring(n.node.x, n.node.y, r + 0.2, r + 2.2, H.highlight, cp, 40);
      else buf.ring(n.node.x, n.node.y, r + 0.4, r + 1.0, H.highlight, c, 32);
    }
    return buf.toGeometry();
  }, [build, drawing, pendingNode]);
  useEffect(() => () => ringsGeo?.dispose(), [ringsGeo]);

  const preview = useMemo(() => {
    if (!drawing || !pendingNode || !hover || hover.kind !== 'node' || hover.id === pendingNode) return null;
    const a = build.nodeById.get(pendingNode);
    const b = build.nodeById.get(hover.id);
    if (!a || !b) return null;
    return [
      new THREE.Vector3(a.node.x, H.highlight + 0.05, -a.node.y),
      new THREE.Vector3(b.node.x, H.highlight + 0.05, -b.node.y),
    ];
  }, [build, drawing, pendingNode, hover]);

  return (
    <group>
      {ringsGeo && <mesh geometry={ringsGeo} material={mat} renderOrder={ORDER.highlight} />}
      {hovGeo && <mesh geometry={hovGeo} material={hoverMat} renderOrder={ORDER.highlight} />}
      {selGeo && <mesh geometry={selGeo} material={mat} renderOrder={ORDER.highlight + 0.5} />}
      {preview && (
        <Line
          points={preview}
          color={palette.selection}
          lineWidth={3}
          dashed
          dashSize={4}
          gapSize={3}
          renderOrder={ORDER.preview}
          depthTest={false}
          transparent
        />
      )}
    </group>
  );
}
