// Live signal state: lamp heads, aspect-coloured stop bars, zebra
// brightening and little pedestrians during a ped phase.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sim } from '../app/simBridge';
import { palette } from '../app/palette';
import { Aspect } from '../sim/types';
import type { RoadBuild } from './build';
import { ORDER, flatMaterial, linear } from './materials';

export function Signals({ build }: { build: RoadBuild }) {
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const pedRef = useRef<THREE.InstancedMesh>(null);
  const stopMesh = useRef<THREE.Mesh>(null);
  const zebraMesh = useRef<THREE.Mesh>(null);

  const res = useMemo(() => {
    const lampGeo = new THREE.BoxGeometry(1.0, 1.5, 1.0);
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const pedGeo = new THREE.CylinderGeometry(0.28, 0.32, 1.7, 8);
    pedGeo.translate(0, 0.85 + 0.1, 0);
    const pedMat = new THREE.MeshLambertMaterial({ color: palette.ped });
    const flat = flatMaterial();
    const zebraMat = flatMaterial();
    return {
      lampGeo, lampMat, pedGeo, pedMat, flat, zebraMat,
      green: linear(palette.signalGreen),
      yellow: linear(palette.signalYellow),
      red: linear(palette.signalRed),
      white: linear(palette.marking),
      off: linear(palette.inkSoft),
      zebraIdle: (() => {
        const a = linear(palette.marking), b = linear(palette.asphalt);
        return [a[0] * 0.55 + b[0] * 0.45, a[1] * 0.55 + b[1] * 0.45, a[2] * 0.55 + b[2] * 0.45];
      })(),
    };
  }, []);
  useEffect(
    () => () => {
      res.lampGeo.dispose(); res.lampMat.dispose(); res.pedGeo.dispose(); res.pedMat.dispose();
      res.flat.dispose(); res.zebraMat.dispose();
    },
    [res],
  );

  const lampCount = build.lamps.length;
  const pedCap = build.crossings.length * 2;

  useLayoutEffect(() => {
    const m = lampRef.current;
    if (m) {
      const o = new THREE.Object3D();
      build.lamps.forEach((l, i) => {
        o.position.set(l.x, l.y, l.z);
        o.rotation.set(0, l.rot, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, new THREE.Color().setRGB(res.off[0], res.off[1], res.off[2]));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) { m.instanceColor.setUsage(THREE.DynamicDrawUsage); m.instanceColor.needsUpdate = true; }
      m.computeBoundingSphere();
    }
    const p = pedRef.current;
    if (p) {
      p.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      p.count = 0;
      p.frustumCulled = false;
    }
  }, [build, res]);

  const last = useRef<{ aspects: Uint8Array | null; ped: Uint8Array | null; build: RoadBuild | null }>({ aspects: null, ped: null, build: null });

  useFrame(({ clock }) => {
    const f = sim.latest;
    const L = last.current;
    const aspects = f ? f.aspects : null;
    const ped = f ? f.pedActive : null;

    if (aspects !== L.aspects || build !== L.build) {
      // lamps
      const m = lampRef.current;
      if (m && m.instanceColor) {
        const arr = m.instanceColor.array as Float32Array;
        for (let i = 0; i < build.lamps.length; i++) {
          const a = aspects ? aspects[build.lamps[i].edge] : Aspect.NoSignal;
          const c = a === Aspect.Green ? res.green : a === Aspect.Yellow ? res.yellow : a === Aspect.Red ? res.red : res.off;
          arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
        }
        m.instanceColor.needsUpdate = true;
      }
      // stop bars
      const sm = stopMesh.current;
      if (sm) {
        const attr = sm.geometry.getAttribute('color') as THREE.BufferAttribute;
        const col = attr.array as Float32Array;
        for (const r of build.stopBarRanges) {
          const a = aspects ? aspects[r.key] : Aspect.NoSignal;
          const c = a === Aspect.Green ? res.green : a === Aspect.Yellow ? res.yellow : a === Aspect.Red ? res.red : res.white;
          for (let v = r.v0; v < r.v1; v++) { col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; }
        }
        attr.needsUpdate = true;
      }
    }

    if (ped !== L.ped || build !== L.build) {
      const zm = zebraMesh.current;
      if (zm) {
        const attr = zm.geometry.getAttribute('color') as THREE.BufferAttribute;
        const col = attr.array as Float32Array;
        for (const r of build.zebraRanges) {
          const c = ped && ped[r.key] ? res.white : res.zebraIdle;
          for (let v = r.v0; v < r.v1; v++) { col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; }
        }
        attr.needsUpdate = true;
      }
    }
    L.aspects = aspects; L.ped = ped; L.build = build;

    // walking figures
    const p = pedRef.current;
    if (p) {
      let n = 0;
      if (ped) {
        const arr = p.instanceMatrix.array as Float32Array;
        const t = clock.elapsedTime;
        for (let i = 0; i < build.crossings.length; i++) {
          const cr = build.crossings[i];
          if (!ped[cr.node]) continue;
          const dx = cr.b[0] - cr.a[0], dy = cr.b[1] - cr.a[1];
          const len = Math.hypot(dx, dy) || 1;
          for (let k = 0; k < 2; k++) {
            let u = ((t * 1.3 + i * 3.7 + k * len * 0.5) / len) % 1;
            if (k === 1) u = 1 - u;
            const side = (k === 0 ? 0.5 : -0.5) / len;
            const x = cr.a[0] + dx * u - dy * side * 1.2;
            const y = cr.a[1] + dy * u + dx * side * 1.2;
            const m = n * 16;
            arr.fill(0, m, m + 16);
            arr[m] = 1; arr[m + 5] = 1; arr[m + 10] = 1; arr[m + 15] = 1;
            arr[m + 12] = x; arr[m + 13] = 0; arr[m + 14] = -y;
            n++;
          }
        }
        p.instanceMatrix.needsUpdate = true;
      }
      p.count = n;
    }
  });

  return (
    <group>
      <mesh ref={stopMesh} geometry={build.stopBars} material={res.flat} renderOrder={ORDER.stopBar} />
      <mesh ref={zebraMesh} geometry={build.zebra} material={res.zebraMat} renderOrder={ORDER.marking} />
      {lampCount > 0 && <instancedMesh key={`l${lampCount}`} ref={lampRef} args={[res.lampGeo, res.lampMat, lampCount]} />}
      {pedCap > 0 && <instancedMesh key={`p${pedCap}`} ref={pedRef} args={[res.pedGeo, res.pedMat, pedCap]} />}
    </group>
  );
}
