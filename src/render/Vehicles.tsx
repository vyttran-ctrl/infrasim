// Instanced vehicles, interpolated between the last two worker frames
// (worker ~30 Hz, display 60 Hz). No allocations in the per-frame path.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sim } from '../app/simBridge';
import { palette, zoneColors } from '../app/palette';
import { VEH_STRIDE, type SimFrame } from '../sim/types';
import { linear } from './materials';

export const VEHICLE_CAPACITY = 1500;
const SNAP_DIST2 = 30 * 30;
const BASE_Y = 0.12;

function box(lx: number, ly: number, lz: number, cx: number, cy: number, cz: number, shade: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(lx, ly, lz);
  g.translate(cx, cy, cz);
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3).fill(shade);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

// Local +x = forward (sim heading 0 → rotation.y 0), base at y = 0.
function carGeometry() {
  return merge([
    box(4.4, 0.72, 1.8, 0, 0.15 + 0.36, 0, 1),
    box(2.3, 0.55, 1.58, -0.35, 0.87 + 0.275, 0, 0.82),
  ]);
}
function busGeometry() {
  return merge([
    box(12, 2.6, 2.5, 0, 0.25 + 1.3, 0, 1),
    box(11.2, 0.75, 2.54, -0.2, 1.75, 0, 0.62),
    box(11.6, 0.18, 2.3, 0, 2.94, 0, 0.92),
  ]);
}
function bikeGeometry() {
  return merge([
    box(1.8, 0.55, 0.22, 0, 0.1 + 0.275, 0, 0.75),
    box(0.55, 0.65, 0.6, -0.1, 0.55 + 0.325, 0, 1),
  ]);
}

interface Interp {
  prev: SimFrame | null;
  cur: SimFrame | null;
  prevAt: number;
  curAt: number;
  index: Map<number, number>;
}

export function Vehicles() {
  const carRef = useRef<THREE.InstancedMesh>(null);
  const busRef = useRef<THREE.InstancedMesh>(null);
  const bikeRef = useRef<THREE.InstancedMesh>(null);

  const res = useMemo(() => {
    const car = carGeometry();
    const bus = busGeometry();
    const bike = bikeGeometry();
    const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const busMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: palette.bus });
    const bikeMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: palette.bike });
    const zoneLUT = new Float32Array(zoneColors.length * 3);
    zoneColors.forEach((h, i) => zoneLUT.set(linear(h), i * 3));
    return { car, bus, bike, carMat, busMat, bikeMat, zoneLUT, neutral: linear(palette.inkSoft) };
  }, []);
  useEffect(
    () => () => {
      res.car.dispose(); res.bus.dispose(); res.bike.dispose();
      res.carMat.dispose(); res.busMat.dispose(); res.bikeMat.dispose();
    },
    [res],
  );

  useLayoutEffect(() => {
    for (const m of [carRef.current, busRef.current, bikeRef.current]) {
      if (!m) continue;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
    }
    const car = carRef.current;
    if (car && !car.instanceColor) {
      car.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VEHICLE_CAPACITY * 3).fill(1), 3);
      car.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
  }, []);

  const st = useRef<Interp>({ prev: null, cur: null, prevAt: 0, curAt: 0, index: new Map() });

  useFrame(() => {
    const car = carRef.current, bus = busRef.current, bike = bikeRef.current;
    if (!car || !bus || !bike) return;
    const s = st.current;
    const now = performance.now();
    const latest = sim.latest;
    if (latest !== s.cur) {
      s.prev = s.cur;
      s.prevAt = s.curAt;
      s.cur = latest;
      s.curAt = now;
      s.index.clear();
      const p = s.prev;
      if (p) {
        const pv = p.vehicles;
        for (let i = 0; i < p.count; i++) s.index.set(pv[i * VEH_STRIDE + 5], i * VEH_STRIDE);
      }
    }
    const f = s.cur;
    if (!f) {
      car.count = 0; bus.count = 0; bike.count = 0;
      return;
    }
    const interval = Math.min(200, Math.max(16, s.curAt - s.prevAt));
    const alpha = s.prev ? Math.min(1, (now - s.curAt) / interval) : 1;
    const v = f.vehicles;
    const pv = s.prev ? s.prev.vehicles : null;
    const cm = car.instanceMatrix.array as Float32Array;
    const bm = bus.instanceMatrix.array as Float32Array;
    const km = bike.instanceMatrix.array as Float32Array;
    const cc = car.instanceColor!.array as Float32Array;
    const lut = res.zoneLUT;
    const zn = zoneColors.length;
    let nc = 0, nb = 0, nk = 0;
    const n = Math.min(f.count, Math.floor(v.length / VEH_STRIDE));
    for (let i = 0; i < n; i++) {
      const o = i * VEH_STRIDE;
      let x = v[o], y = v[o + 1], h = v[o + 2];
      if (pv && alpha < 1) {
        const j = s.index.get(v[o + 5]);
        if (j !== undefined) {
          const px = pv[j], py = pv[j + 1];
          const dx = x - px, dy = y - py;
          if (dx * dx + dy * dy < SNAP_DIST2) {
            x = px + dx * alpha;
            y = py + dy * alpha;
            let dh = h - pv[j + 2];
            if (dh > Math.PI) dh -= Math.PI * 2;
            else if (dh < -Math.PI) dh += Math.PI * 2;
            h = pv[j + 2] + dh * alpha;
          }
        }
      }
      const kind = v[o + 4];
      let arr: Float32Array;
      let k: number;
      if (kind === 1) { if (nb >= VEHICLE_CAPACITY) continue; arr = bm; k = nb++; }
      else if (kind === 2) { if (nk >= VEHICLE_CAPACITY) continue; arr = km; k = nk++; }
      else {
        if (nc >= VEHICLE_CAPACITY) continue;
        arr = cm; k = nc++;
        const z = v[o + 6];
        const c3 = k * 3;
        if (z >= 0 && z === z) {
          const zi = (Math.floor(z) % zn) * 3;
          cc[c3] = lut[zi]; cc[c3 + 1] = lut[zi + 1]; cc[c3 + 2] = lut[zi + 2];
        } else {
          cc[c3] = res.neutral[0]; cc[c3 + 1] = res.neutral[1]; cc[c3 + 2] = res.neutral[2];
        }
      }
      // rotation about Y by h, translation (x, BASE_Y, -y); column-major
      const c = Math.cos(h), sn = Math.sin(h);
      const m = k * 16;
      arr[m] = c; arr[m + 1] = 0; arr[m + 2] = -sn; arr[m + 3] = 0;
      arr[m + 4] = 0; arr[m + 5] = 1; arr[m + 6] = 0; arr[m + 7] = 0;
      arr[m + 8] = sn; arr[m + 9] = 0; arr[m + 10] = c; arr[m + 11] = 0;
      arr[m + 12] = x; arr[m + 13] = BASE_Y; arr[m + 14] = -y; arr[m + 15] = 1;
    }
    car.count = nc; bus.count = nb; bike.count = nk;
    car.instanceMatrix.needsUpdate = true;
    bus.instanceMatrix.needsUpdate = true;
    bike.instanceMatrix.needsUpdate = true;
    car.instanceColor!.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={carRef} args={[res.car, res.carMat, VEHICLE_CAPACITY]} />
      <instancedMesh ref={busRef} args={[res.bus, res.busMat, VEHICLE_CAPACITY]} />
      <instancedMesh ref={bikeRef} args={[res.bike, res.bikeMat, VEHICLE_CAPACITY]} />
    </group>
  );
}
