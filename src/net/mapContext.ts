// Render-only map context (basemap layers + building footprints) for networks
// built from real map data. Kept out of RoadNetwork on purpose: networks go to
// the worker and into saved scenarios, this can be megabytes. Waterloo's is
// baked into lazily-loaded JSON chunks; other OSM imports are fetched from
// Overpass once per area per session.

import type { RoadNetwork } from '../sim/types';
import { basemapClauses, convertBasemap, EMPTY_BASEMAP, unpackBasemap, type BasemapData, type PackedBasemap } from './basemap';
import { buildingClauses, convertBuildings, loadWaterlooBuildings, type BuildingFootprint } from './buildings';
import type { BBox } from './osm';
import { fetchOverpass } from './overpass';
import { WATERLOO_BBOX } from './waterlooZones';

export interface MapContext {
  basemap: BasemapData;
  buildings: BuildingFootprint[];
}

const EMPTY: MapContext = { basemap: EMPTY_BASEMAP, buildings: [] };

/** Bounding box a network's local metres refer to (old saved Waterloo scenarios predate `geo`). */
export function networkGeo(net: Pick<RoadNetwork, 'id' | 'geo'>): BBox | undefined {
  return net.geo ?? (net.id === 'waterloo' ? WATERLOO_BBOX : undefined);
}

export async function loadWaterlooBasemap(): Promise<BasemapData> {
  const mod = await import('./waterlooBasemap.json');
  return unpackBasemap((mod.default ?? mod) as unknown as PackedBasemap);
}

/** One Overpass query for everything drawn around a live-imported network. */
export function mapContextQuery(b: BBox): string {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:60];(${basemapClauses(box)}${buildingClauses(box)});out geom qt;`;
}

const cache = new Map<string, Promise<MapContext>>();

/** Basemap + buildings for a network built from map data (empty otherwise). Cached; never rejects. */
export function getMapContext(net: Pick<RoadNetwork, 'id' | 'geo'>): Promise<MapContext> {
  const geo = networkGeo(net);
  if (!geo) return Promise.resolve(EMPTY);
  const key = net.id === 'waterloo' ? 'waterloo' : `${geo.south},${geo.west},${geo.north},${geo.east}`;
  let p = cache.get(key);
  if (!p) {
    p = (net.id === 'waterloo'
      ? Promise.all([loadWaterlooBasemap(), loadWaterlooBuildings()]).then(([basemap, buildings]) => ({ basemap, buildings }))
      : fetchOverpass(mapContextQuery(geo)).then((json) => ({ basemap: convertBasemap(json, geo), buildings: convertBuildings(json, geo) }))
    ).catch(() => {
      cache.delete(key); // allow a retry on the next load
      return EMPTY;
    });
    cache.set(key, p);
  }
  return p;
}

/** Building footprints only (see getMapContext). */
export async function getBuildings(net: Pick<RoadNetwork, 'id' | 'geo'>): Promise<BuildingFootprint[]> {
  return (await getMapContext(net)).buildings;
}
