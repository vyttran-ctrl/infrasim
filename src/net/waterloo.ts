// Baked Waterloo snapshot (see scripts/bake-waterloo.mjs). Loaded lazily so
// the JSON lands in its own chunk.

import type { RoadNetwork } from '../sim/types';

export async function loadWaterloo(): Promise<RoadNetwork> {
  const mod = await import('./waterloo.json');
  const data = (mod.default ?? mod) as unknown as RoadNetwork;
  // Hand out a private copy so nobody can mutate the cached module object.
  return structuredClone(data);
}
