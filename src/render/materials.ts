// Shared materials and colour lookup tables. Flat road layers are drawn in
// the transparent pass with explicit renderOrder and no depth writes, so
// stacking is deterministic and z-fighting can't happen.

import * as THREE from 'three';
import { congestionColor } from '../app/palette';

export const ORDER = {
  ground: -10,
  asphalt: 1,
  fill: 2,
  heat: 3,
  marking: 4,
  stopBar: 5,
  highlight: 6,
  preview: 7,
  label: 8,
};

export function flatMaterial(opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function solidMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/** Invisible-but-raycastable material for pick meshes. */
export function pickMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
}

/** 0..1 congestion -> linear RGB, 65 steps. */
export const CONGESTION_LUT: Float32Array = (() => {
  const n = 65;
  const out = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.set(congestionColor(i / (n - 1)));
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
})();

export function lutIndex(t: number): number {
  const k = Math.round(Math.max(0, Math.min(1, t)) * 64);
  return k * 3;
}

export function linear(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
