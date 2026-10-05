// Paper ground with a faint plan-sheet grid (100 m major, 20 m minor) that
// fades into the page colour away from the network.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { palette } from '../app/palette';

const vert = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = vec2(w.x, -w.z);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform vec3 uGround;
uniform vec3 uPaper;
uniform vec3 uLine;
uniform vec4 uBounds; // minX, minY, maxX, maxY
varying vec2 vWorld;

float gridLine(vec2 p, float spacing, float px) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
  vec2 w = fwidth(p) * px;
  vec2 l = 1.0 - smoothstep(vec2(0.0), w, g);
  return max(l.x, l.y);
}

void main() {
  vec2 c = clamp(vWorld, uBounds.xy, uBounds.zw);
  float d = length(vWorld - c);
  float inside = 1.0 - smoothstep(60.0, 420.0, d);
  vec3 col = mix(uPaper, uGround, inside);
  // fade minor lines out when zoomed far (fwidth large)
  float fw = length(fwidth(vWorld));
  float minorVis = 1.0 - smoothstep(0.6, 2.0, fw);
  float major = gridLine(vWorld, 100.0, 1.2);
  float minor = gridLine(vWorld, 20.0, 0.9) * minorVis;
  float a = max(major * 0.85, minor * 0.35) * (0.35 + 0.65 * inside);
  col = mix(col, uLine, a);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function Ground(props: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onMove: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const { bounds } = props;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uGround: { value: new THREE.Color(palette.ground) },
          uPaper: { value: new THREE.Color(palette.paper) },
          uLine: { value: new THREE.Color(palette.groundLine) },
          uBounds: { value: new THREE.Vector4() },
        },
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uBounds.value.set(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 12000;

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[cx, 0, -cy]}
      renderOrder={-10}
      material={material}
      onClick={props.onClick}
      onPointerMove={props.onMove}
    >
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
