// Real-map layers for networks built from map data: the OSM basemap under the
// roads and the OSM building footprints. Fetched per network through
// net/mapContext (never stored in RoadNetwork).

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { getMapContext, networkGeo, type MapContext } from '../net/mapContext';
import type { RoadNetwork } from '../sim/types';
import { Basemap } from './Basemap';
import type { RoadBuild } from './build';
import { buildFootprints } from './footprints';

export function RealMap({ network, build }: { network: RoadNetwork; build: RoadBuild }) {
  const geo = networkGeo(network);
  const key = geo ? `${network.id}|${geo.south},${geo.west},${geo.north},${geo.east}` : '';
  const [loaded, setLoaded] = useState<{ key: string; ctx: MapContext } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    getMapContext(network).then((ctx) => { if (live) setLoaded({ key, ctx }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ctx = loaded && loaded.key === key ? loaded.ctx : null;
  const mesh = useMemo(() => (ctx && ctx.buildings.length ? buildFootprints(ctx.buildings, build) : null), [ctx, build]);
  useEffect(() => () => mesh?.geometry.dispose(), [mesh]);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  if (!geo || !ctx) return null;
  return (
    <group>
      <Basemap geo={geo} data={ctx.basemap} />
      {mesh && <mesh geometry={mesh.geometry} material={mat} raycast={() => null} />}
    </group>
  );
}
