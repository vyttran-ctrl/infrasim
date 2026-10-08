// Live OpenStreetMap import through the Overpass API.

import type { RoadNetwork } from '../sim/types';
import type { BBox, OverpassJson } from './osm';
import { bboxSize, convertOverpass, junctionCount, overpassQuery } from './osm';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
/** Largest side accepted for a live import, metres. */
export const MAX_IMPORT_SIDE = 2500;
const TIMEOUT_MS = 30_000;

class FriendlyError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'ImportError';
  }
}

function cancelled(): Error {
  const e = new Error('Import cancelled.');
  e.name = 'AbortError';
  return e;
}

async function fetchOnce(url: string, query: string, signal?: AbortSignal): Promise<OverpassJson> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctl.signal,
      });
    } catch {
      if (signal?.aborted) throw cancelled();
      if (timedOut) throw new FriendlyError('OpenStreetMap server took too long to answer. Try a smaller area or try again.', true);
      throw new FriendlyError("Couldn't reach the OpenStreetMap server. Check your connection and try again.", true);
    }
    if (res.status === 429) throw new FriendlyError('OpenStreetMap server is rate-limiting requests. Wait a minute and try again.', true);
    if (res.status === 504 || res.status === 503) throw new FriendlyError('OpenStreetMap server is busy. Try again in a moment.', true);
    if (!res.ok) throw new FriendlyError(`OpenStreetMap server error (HTTP ${res.status}).`, true);
    try {
      return (await res.json()) as OverpassJson;
    } catch {
      if (signal?.aborted) throw cancelled();
      throw new FriendlyError('OpenStreetMap server sent an unreadable response. Try again.', true);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** POST a query to the Overpass endpoints in turn; resolves with the parsed JSON. */
export async function fetchOverpass(query: string, signal?: AbortSignal): Promise<OverpassJson> {
  let lastErr: Error | null = null;
  for (const url of ENDPOINTS) {
    try {
      return await fetchOnce(url, query, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e as Error;
      if (!(e instanceof FriendlyError && e.retryable)) break;
    }
  }
  throw new Error(lastErr?.message ?? "Couldn't reach the OpenStreetMap server.");
}

export async function importOverpass(bbox: BBox, signal?: AbortSignal): Promise<RoadNetwork> {
  const vals = [bbox.south, bbox.west, bbox.north, bbox.east];
  if (vals.some((v) => !Number.isFinite(v)) || bbox.south >= bbox.north || bbox.west >= bbox.east || Math.abs(bbox.south) > 85 || Math.abs(bbox.north) > 85) {
    throw new Error('Invalid area. Draw a box with a south-west and north-east corner.');
  }
  const { width, height } = bboxSize(bbox);
  if (width > MAX_IMPORT_SIDE * 1.02 || height > MAX_IMPORT_SIDE * 1.02) {
    throw new Error(`Area too large (${(width / 1000).toFixed(1)} × ${(height / 1000).toFixed(1)} km). Pick an area up to 2.5 × 2.5 km.`);
  }
  if (width < 150 || height < 150) throw new Error('Area too small. Pick an area at least a few blocks across.');
  if (signal?.aborted) throw cancelled();

  const json = await fetchOverpass(overpassQuery(bbox), signal);
  const ways = (json.elements ?? []).filter((e) => e.type === 'way').length;
  if (ways === 0) throw new Error('No roads found in this area.');

  const c = (v: number) => v.toFixed(4);
  const net = convertOverpass(json, bbox, {
    id: `osm-${c(bbox.south)}-${c(bbox.west)}`,
    name: `OSM import (${c((bbox.south + bbox.north) / 2)}, ${c((bbox.west + bbox.east) / 2)})`,
  });
  if (junctionCount(net) < 2 || net.zones.length < 2 || net.edges.length < 4) {
    throw new Error('Too few connected roads here to simulate. Try a larger or more urban area.');
  }
  return net;
}
