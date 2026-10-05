// Static road layers, city blocks, buildings and the live congestion overlay.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';
import { palette } from '../app/palette';
import { EDGE_STRIDE, type SimFrame } from '../sim/types';
import type { RoadBuild } from './build';
import { CONGESTION_LUT, ORDER, flatMaterial, linear, lutIndex, solidMaterial } from './materials';

export function Roads({ build }: { build: RoadBuild }) {
  const mats = useMemo(
    () => ({
      asphalt: flatMaterial(),
      fills: flatMaterial(),
      heat: flatMaterial(0.72),
      markings: flatMaterial(),
      solids: solidMaterial(),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group>
      <mesh geometry={build.asphalt} material={mats.asphalt} renderOrder={ORDER.asphalt} />
      <mesh geometry={build.fills} material={mats.fills} renderOrder={ORDER.fill} />
      <HeatOverlay build={build} material={mats.heat} />
      <mesh geometry={build.markings} material={mats.markings} renderOrder={ORDER.marking} />
      <mesh geometry={build.solids} material={mats.solids} />
      <Buildings build={build} />
    </group>
  );
}

function HeatOverlay({ build, material }: { build: RoadBuild; material: THREE.Material }) {
  const mesh = useRef<THREE.Mesh>(null);
  const last = useRef<{ frame: SimFrame | null; heat: string; build: RoadBuild | null; tick: number }>({ frame: null, heat: '', build: null, tick: 0 });
  const closedRGB = useMemo(() => linear(palette.asphaltClosed), []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const L = last.current;
    if (++L.tick % 4 !== 0) return;
    const heat = useApp.getState().heat;
    const frame = sim.latest;
    const stats = frame?.edgeStats;
    const n = build.edges.length;
    if (heat === 'off' || !frame || !stats || stats.length < EDGE_STRIDE * Math.min(1, n)) {
      m.visible = false;
      L.frame = null;
      return;
    }
    m.visible = true;
    if (L.frame === frame && L.heat === heat && L.build === build) return;
    L.frame = frame; L.heat = heat; L.build = build;
    const attr = (m.geometry as THREE.BufferGeometry).getAttribute('color') as THREE.BufferAttribute;
    const col = attr.array as Float32Array;
    for (const r of build.heatRanges) {
      const edge = build.byIndex[r.key]?.edge;
      const o = r.key * EDGE_STRIDE;
      let cr: number, cg: number, cb: number;
      if (!edge || edge.closed || o + 3 >= stats.length) {
        cr = closedRGB[0]; cg = closedRGB[1]; cb = closedRGB[2];
      } else {
        let t: number;
        if (heat === 'utilization') t = stats[o + 3];
        else if (heat === 'speed') t = stats[o] > 0 ? 1 - stats[o + 1] / Math.max(1, edge.speedLimit) : 0;
        else t = stats[o + 2] / Math.max(3, (0.6 * edge.lanes * edge.length) / 7.5);
        const k = lutIndex(t);
        cr = CONGESTION_LUT[k]; cg = CONGESTION_LUT[k + 1]; cb = CONGESTION_LUT[k + 2];
      }
      for (let v = r.v0; v < r.v1; v++) {
        col[v * 3] = cr; col[v * 3 + 1] = cg; col[v * 3 + 2] = cb;
      }
    }
    attr.needsUpdate = true;
  });

  return <mesh ref={mesh} geometry={build.heat} material={material} renderOrder={ORDER.heat} visible={false} />;
}

function Buildings({ build }: { build: RoadBuild }) {
  const count = build.buildings.length;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    // darken the bottom vertices a touch (fake AO)
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const f = pos.getY(i) < 0.01 ? 0.8 : 1;
      colors[i * 3] = f; colors[i * 3 + 1] = f; colors[i * 3 + 2] = f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    build.buildings.forEach((b, i) => {
      o.position.set(b.x, 0.2, -b.y);
      o.rotation.set(0, b.rot, 0);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      c.setRGB(b.color[0], b.color[1], b.color[2]);
      m.setColorAt(i, c);
    });
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [build, count]);

  if (count === 0) return null;
  return <instancedMesh key={count} ref={ref} args={[geo, mat, count]} />;
}
