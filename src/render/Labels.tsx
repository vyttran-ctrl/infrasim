// Street names painted flat beside arterials, shown only when zoomed in.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type * as THREE from 'three';
import { palette } from '../app/palette';
import type { RoadBuild } from './build';
import { cameraState } from './events';
import { ORDER } from './materials';

const SHOW_BELOW = 700; // camera distance, metres
const MAX_LABELS = 80;

export function Labels({ build }: { build: RoadBuild }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (g) g.visible = cameraState.distance < SHOW_BELOW;
  });
  const labels = build.labels.slice(0, MAX_LABELS);
  return (
    <group ref={group} visible={false}>
      {labels.map((l, i) => (
        <Text
          key={`${l.text}-${i}`}
          position={[l.x, 0.3, -l.y]}
          rotation={[-Math.PI / 2, 0, l.angle]}
          fontSize={l.size}
          color={palette.inkSoft}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.04}
          renderOrder={ORDER.label}
        >
          {l.text.toUpperCase()}
        </Text>
      ))}
    </group>
  );
}
