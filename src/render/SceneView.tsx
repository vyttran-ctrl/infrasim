// The 3D city view. Fills its parent; reads the network from the store and
// live vehicles/signals from sim.latest inside useFrame.

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useApp } from '../app/store';
import { palette } from '../app/palette';
import { buildRoads, disposeBuild } from './build';
import { CameraRig } from './CameraRig';
import { Ground } from './Ground';
import { networkGeo } from '../net/mapContext';
import { RealMap } from './RealMap';
import { preferredView } from './views';
import { Interaction, type PickHandlers } from './Interaction';
import { Labels } from './Labels';
import { Roads } from './Roads';
import { Signals } from './Signals';
import { Vehicles } from './Vehicles';

export interface SceneViewProps {
  onPickEdge: (edgeId: string) => void;
  onPickNode: (nodeId: string) => void;
  onPickNone: () => void;
}

export function SceneView(props: SceneViewProps): JSX.Element {
  const handlers = useRef<PickHandlers>(props);
  handlers.current = props;

  return (
    <div style={{ position: 'absolute', inset: 0 }} onPointerLeave={() => { if (useApp.getState().hover) useApp.getState().setHover(null); }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        frameloop="always"
        flat
        camera={{ fov: 35, near: 1, far: 20000, position: [0, 600, 420] }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <color attach="background" args={[palette.paper]} />
        {/* physical light units: x PI so a lit top face lands near its palette colour */}
        <hemisphereLight args={['#ffffff', palette.ground, 0.74 * Math.PI]} />
        <directionalLight position={[-300, 600, 250]} intensity={0.36 * Math.PI} />
        <World handlers={handlers} />
      </Canvas>
    </div>
  );
}

function World({ handlers }: { handlers: React.MutableRefObject<PickHandlers> }) {
  const network = useApp((s) => s.network);
  const build = useMemo(() => buildRoads(network), [network]);
  const geo = networkGeo(network);
  const view = useMemo(() => preferredView(network), [network.id, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeBuild(build), [build]);

  const onGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    handlers.current.onPickNone();
  };
  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    const st = useApp.getState();
    if (st.hover) st.setHover(null);
    const el = e.nativeEvent.target as HTMLElement | null;
    if (el && el.style && el.style.cursor) el.style.cursor = '';
  };

  return (
    <>
      <CameraRig build={build} networkId={network.id} view={view} />
      <Ground bounds={build.bounds} onClick={onGroundClick} onMove={onGroundMove} />
      <Roads build={build} />
      {geo && <RealMap network={network} build={build} />}
      <Signals build={build} />
      <Vehicles />
      <Interaction build={build} handlers={handlers} />
      <Labels build={build} />
    </>
  );
}
