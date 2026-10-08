// Preferred default framing per network (sim metres). Falls back to the
// network bounds.

import { networkGeo } from '../net/mapContext';
import { projector } from '../net/osm';
import { UPTOWN_CENTRE, UW_CENTRE } from '../net/waterlooZones';
import type { RoadNetwork } from '../sim/types';

export interface ViewBox { minX: number; minY: number; maxX: number; maxY: number }

export function preferredView(net: RoadNetwork): ViewBox | null {
  const geo = networkGeo(net);
  if (net.id !== 'waterloo' || !geo) return null;
  // University of Waterloo (inside Ring Road) to Uptown (King & Erb)
  const p = projector(geo);
  const [ux, uy] = p.toXY(UW_CENTRE[0], UW_CENTRE[1]);
  const [tx, ty] = p.toXY(UPTOWN_CENTRE[0], UPTOWN_CENTRE[1]);
  const pad = 380;
  return { minX: Math.min(ux, tx) - pad, maxX: Math.max(ux, tx) + pad, minY: Math.min(uy, ty) - pad, maxY: Math.max(uy, ty) + pad };
}
