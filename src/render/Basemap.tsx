// Plan-sheet basemap for networks built from map data: OSM parks, water,
// campus grounds, parking, every street and path, rail and streams, drawn
// flat under the simulated roads in muted paper tones (colour stays with the
// congestion data). Same projector as the network, so OSM streets sit exactly
// under the simulated road ribbons. Fades into the plain ground beyond the
// network area.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { palette } from '../app/palette';
import type { AreaKind, BasemapData, LineKind, MapLabel } from '../net/basemap';
import type { BBox } from '../net/osm';
import { projector } from '../net/osm';
import { FlatBuf, rgb, type RGB } from './buffers';
import { cameraState } from './events';
import { ORDER } from './materials';
import { makeStrip, type P2 } from './polyline';

const AREA_COLOR: Record<AreaKind, string> = {
  campus: '#e6e0d1',
  green: '#dce3cd',
  wood: '#d2dcc2',
  pitch: '#d4dfc6',
  parking: '#e0ddd5',
  plaza: '#e8e4da',
  rail: '#e1ded7',
  water: '#cddce2',
};
const LINE_STYLE: Record<LineKind, { color: string; width: number }> = {
  service: { color: '#f1efe8', width: 4.5 },
  path: { color: '#f6f3ec', width: 1.6 },
  street: { color: '#f6f4ee', width: 8.5 },
  major: { color: '#f6f4ee', width: 13 },
  stream: { color: '#bfd2da', width: 3 },
  rail: { color: '#9d9a92', width: 1.5 },
};
/** Drawn beyond the network bbox, metres, then faded out into the ground. */
const MARGIN = 430;
const FADE = 300;

const vert = /* glsl */ `
varying vec3 vCol;
varying vec2 vWorld;
void main() {
  vCol = color;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = vec2(w.x, -w.z);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform vec4 uBox;
uniform float uMargin;
uniform float uFade;
varying vec3 vCol;
varying vec2 vWorld;
void main() {
  vec2 q = clamp(vWorld, uBox.xy, uBox.zw);
  float d = length(vWorld - q);
  float a = 1.0 - smoothstep(uMargin - uFade, uMargin, d);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

export function buildBasemap(data: BasemapData): THREE.BufferGeometry {
  const buf = new FlatBuf();
  const area: Record<string, RGB> = {};
  for (const k of Object.keys(AREA_COLOR) as AreaKind[]) area[k] = rgb(AREA_COLOR[k]);
  for (const a of data.areas) {
    const [outer, ...holes] = a.rings;
    if (!outer || outer.length < 3) continue;
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(
        outer.map((p) => new THREE.Vector2(p[0], p[1])),
        holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
      );
    } catch {
      continue;
    }
    const pts = [...outer, ...holes.flat()];
    const base = buf.vertexCount;
    const c = area[a.kind];
    for (const p of pts) {
      buf.pos.push(p[0], 0, -p[1]);
      buf.col.push(c[0], c[1], c[2]);
    }
    for (const t of tris) buf.idx.push(base + t[0], base + t[1], base + t[2]);
  }
  for (const l of data.lines) {
    const st = LINE_STYLE[l.kind];
    const strip = makeStrip(l.pts as P2[]);
    if (!strip) continue;
    buf.ribbon(strip, -st.width / 2, st.width / 2, 0, rgb(st.color));
  }
  return buf.toGeometry();
}

export function Basemap({ geo, data }: { geo: BBox; data: BasemapData }) {
  const geometry = useMemo(() => buildBasemap(data), [data]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => {
    const p = projector(geo);
    const [x0, y0] = p.toXY(geo.south, geo.west);
    const [x1, y1] = p.toXY(geo.north, geo.east);
    return new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      vertexColors: true,
      uniforms: { uBox: { value: new THREE.Vector4(x0, y0, x1, y1) }, uMargin: { value: MARGIN }, uFade: { value: FADE } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [geo.south, geo.west, geo.north, geo.east]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group>
      <mesh geometry={geometry} material={material} position={[0, 0.006, 0]} renderOrder={ORDER.ground + 1} raycast={() => null} />
      <AreaLabels labels={data.labels} />
    </group>
  );
}

const LABEL_COLOR: Record<MapLabel['kind'], string> = { campus: '#6d6656', park: '#5f7257', water: '#58717d' };

/** Names of the big places (campuses always; parks and water when closer). */
function AreaLabels({ labels }: { labels: MapLabel[] }) {
  const near = useRef<THREE.Group>(null);
  useFrame(() => {
    if (near.current) near.current.visible = cameraState.distance < 1700;
  });
  const big = labels.filter((l) => l.kind === 'campus');
  const small = labels.filter((l) => l.kind !== 'campus');
  const item = (l: MapLabel, i: number) => (
    <Text
      key={`${l.text}-${i}`}
      position={[l.x, 0.25, -l.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={l.size}
      color={LABEL_COLOR[l.kind]}
      anchorX="center"
      anchorY="middle"
      letterSpacing={l.kind === 'campus' ? 0.12 : 0.05}
      maxWidth={l.size * 14}
      textAlign="center"
      renderOrder={ORDER.label}
      fillOpacity={l.kind === 'campus' ? 0.8 : 0.9}
      outlineWidth="7%"
      outlineColor={palette.paper}
      outlineOpacity={0.85}
      raycast={() => null}
    >
      {l.kind === 'campus' ? l.text.toUpperCase() : l.text}
      {/* map annotation: stays readable over the extruded buildings */}
      <meshBasicMaterial attach="material" depthTest={false} depthWrite={false} transparent />
    </Text>
  );
  return (
    <group>
      {big.map(item)}
      <group ref={near}>{small.map(item)}</group>
    </group>
  );
}
