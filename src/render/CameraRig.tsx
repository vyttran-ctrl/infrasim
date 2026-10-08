// MapControls + framing / focus animation + adaptive near/far planes.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { cameraState, onCameraCommand } from './events';
import type { RoadBuild } from './build';
import { sampleAt } from './polyline';
import type { ViewBox } from './views';

const ELEV = (55 * Math.PI) / 180;

interface Anim {
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromP: THREE.Vector3;
  toP: THREE.Vector3;
  t: number;
  dur: number;
}

export function CameraRig(props: { build: RoadBuild; networkId: string; view?: ViewBox | null }) {
  const { build, networkId } = props;
  const viewRef = useRef(props.view);
  viewRef.current = props.view;
  const controls = useRef<MapControlsImpl | null>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const anim = useRef<Anim | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const first = useRef(true);
  const lastNear = useRef(0);

  const extent = Math.max(build.bounds.maxX - build.bounds.minX, build.bounds.maxY - build.bounds.minY, 200);

  const startAnim = (target: THREE.Vector3, pos: THREE.Vector3, instant: boolean) => {
    const c = controls.current;
    if (!c) return;
    if (instant) {
      c.target.copy(target);
      camera.position.copy(pos);
      c.update();
      anim.current = null;
      return;
    }
    anim.current = { fromT: c.target.clone(), toT: target, fromP: camera.position.clone(), toP: pos, t: 0, dur: 0.7 };
  };

  const frame = (instant: boolean) => {
    const b = viewRef.current ?? buildRef.current.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const w = Math.max(60, b.maxX - b.minX);
    const h = Math.max(60, b.maxY - b.minY);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    const d = Math.max((h * Math.sin(ELEV) * 0.5) / tanH, (w * 0.5) / (tanH * aspect)) * 1.12 + 40;
    const target = new THREE.Vector3(cx, 0, -cy);
    const pos = new THREE.Vector3(cx, d * Math.sin(ELEV), -cy + d * Math.cos(ELEV));
    startAnim(target, pos, instant);
  };

  const focus = (kind: 'edge' | 'node', id: string) => {
    const b = buildRef.current;
    let x: number, y: number;
    if (kind === 'node') {
      const n = b.nodeById.get(id);
      if (!n) return;
      x = n.node.x; y = n.node.y;
    } else {
      const e = b.edgeById.get(id);
      if (!e) return;
      const m = sampleAt(e.pts, e.cum, e.length / 2);
      x = m.p[0]; y = m.p[1];
    }
    const c = controls.current;
    if (!c) return;
    const offset = camera.position.clone().sub(c.target);
    const dist = offset.length();
    if (dist > 420) offset.multiplyScalar(420 / dist);
    const target = new THREE.Vector3(x, 0, -y);
    startAnim(target, target.clone().add(offset), false);
  };

  // frame on network change
  useEffect(() => {
    // wait a tick so controls are mounted
    const id = requestAnimationFrame(() => {
      frame(first.current);
      first.current = false;
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId]);

  useEffect(
    () =>
      onCameraCommand((cmd) => {
        if (cmd.type === 'reset') frame(false);
        else focus(cmd.target.kind, cmd.target.id);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camera, size.width, size.height],
  );

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      c.target.lerpVectors(a.fromT, a.toT, k);
      camera.position.lerpVectors(a.fromP, a.toP, k);
      c.update();
      if (a.t >= 1) anim.current = null;
    }
    // keep the camera above the ground even while panning
    if (camera.position.y < 4) camera.position.y = 4;
    const dist = camera.position.distanceTo(c.target);
    cameraState.distance = dist;
    const near = Math.max(0.5, dist * 0.02);
    if (Math.abs(near - lastNear.current) / near > 0.05) {
      lastNear.current = near;
      camera.near = near;
      camera.far = Math.max(4000, dist * 40);
      camera.updateProjectionMatrix();
    }
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning={false}
      minDistance={15}
      maxDistance={Math.max(3000, extent * 3)}
      minPolarAngle={0.05}
      maxPolarAngle={1.32}
      zoomToCursor
      onStart={() => { anim.current = null; }}
    />
  );
}
