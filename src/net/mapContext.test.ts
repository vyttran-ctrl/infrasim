import { describe, expect, it } from 'vitest';
import { convertBasemap, packBasemap, signedArea, unpackBasemap, type GeomElement } from './basemap';
import { convertBuildings, packBuildings, unpackBuildings } from './buildings';
import { buildGrid } from './grid';
import { getMapContext, networkGeo } from './mapContext';
import type { BBox } from './osm';
import { projector } from './osm';
import { loadWaterloo } from './waterloo';
import { WATERLOO_BBOX } from './waterlooZones';

const BOX: BBox = { south: 43.0, west: -80.01, north: 43.01, east: -80.0 };
const C = { lat: 43.005, lon: -80.005 };
// ~1 m in degrees around the box centre
const DLAT = 1 / 111195;
const DLON = 1 / (111195 * Math.cos((43.005 * Math.PI) / 180));
const sq = (x0: number, y0: number, w: number, h: number, ccw = true) => {
  const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]];
  if (!ccw) pts.reverse();
  return pts.map(([x, y]) => ({ lat: C.lat + y * DLAT, lon: C.lon + x * DLON }));
};

describe('building footprints', () => {
  const json: { elements: GeomElement[] } = {
    elements: [
      { type: 'way', id: 1, tags: { building: 'apartments', 'building:levels': '3' }, geometry: sq(0, 0, 20, 10, false) },
      { type: 'way', id: 2, tags: { building: 'house' }, geometry: sq(40, 0, 10, 8) },
      { type: 'way', id: 3, tags: { building: 'no' }, geometry: sq(80, 0, 10, 8) },
      { type: 'way', id: 4, tags: { building: 'yes', height: '42 m' }, geometry: sq(120, 0, 2, 2) }, // too small (4 m²)
      {
        type: 'relation', id: 5, tags: { building: 'university' },
        members: [
          { type: 'way', role: 'outer', geometry: sq(0, 50, 30, 30).slice(0, 3) },
          { type: 'way', role: 'outer', geometry: sq(0, 50, 30, 30).slice(2) },
        ],
      },
    ],
  };
  const list = convertBuildings(json, BOX);

  it('converts ways and stitched multipolygons, CCW, with heights', () => {
    expect(list).toHaveLength(3);
    const [apt, house, uni] = list;
    expect(apt.h).toBeCloseTo(3 * 3.2 + 0.6, 1);
    expect(apt.kind).toBe('apartments');
    expect(house.h).toBe(7);
    expect(uni.kind).toBe('civic');
    for (const f of list) {
      expect(signedArea(f.pts)).toBeGreaterThan(0);
      expect(f.pts.length).toBe(4);
    }
    const p = projector(BOX);
    const [cx, cy] = p.toXY(C.lat, C.lon);
    expect(Math.abs(Math.abs(signedArea(apt.pts)) - 200)).toBeLessThan(3);
    expect(Math.min(...apt.pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy)))).toBeLessThan(0.2);
  });

  it('round-trips through the packed form at 0.1 m', () => {
    const back = unpackBuildings(packBuildings(list));
    expect(back).toEqual(list);
  });
});

describe('basemap', () => {
  const json: { elements: GeomElement[] } = {
    elements: [
      { type: 'way', id: 1, tags: { leisure: 'park', name: 'Big Park' }, geometry: sq(-150, -150, 300, 300) },
      { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: sq(-200, 200, 400, 0).slice(0, 2) },
      { type: 'way', id: 3, tags: { highway: 'footway', footway: 'sidewalk' }, geometry: sq(-200, 210, 400, 0).slice(0, 2) },
      { type: 'way', id: 4, tags: { natural: 'water' }, geometry: sq(-20, -20, 40, 40, false) },
      { type: 'way', id: 5, tags: { railway: 'light_rail' }, geometry: sq(-200, -200, 400, 400).slice(0, 3) },
    ],
  };
  const map = convertBasemap(json, BOX);

  it('keeps areas, streets and rail; skips sidewalks; labels big parks', () => {
    expect(map.areas.map((a) => a.kind)).toEqual(['green', 'water']); // paint order: water on top
    for (const a of map.areas) expect(signedArea(a.rings[0])).toBeGreaterThan(0);
    expect(map.lines.map((l) => l.kind).sort()).toEqual(['rail', 'street']);
    expect(map.labels).toHaveLength(1);
    expect(map.labels[0]).toMatchObject({ text: 'Big Park', kind: 'park' });
    expect(unpackBasemap(packBasemap(map))).toEqual(map);
  });
});

describe('map context registry', () => {
  it('is empty for networks without map data', async () => {
    const grid = buildGrid();
    expect(networkGeo(grid)).toBeUndefined();
    const ctx = await getMapContext(grid);
    expect(ctx.buildings).toHaveLength(0);
    expect(ctx.basemap.areas).toHaveLength(0);
  });

  it('serves the baked Waterloo basemap and buildings', async () => {
    const net = await loadWaterloo();
    expect(networkGeo(net)).toEqual(WATERLOO_BBOX);
    const ctx = await getMapContext(net);
    expect(ctx.buildings.length).toBeGreaterThan(3000);
    for (const b of ctx.buildings) {
      expect(b.h).toBeGreaterThan(2);
      expect(signedArea(b.pts)).toBeGreaterThan(0);
    }
    const names = ctx.basemap.labels.map((l) => l.text);
    for (const n of ['University of Waterloo', 'Wilfrid Laurier University', 'Waterloo Park', 'Silver Lake']) expect(names).toContain(n);
    expect(ctx.basemap.lines.length).toBeGreaterThan(1000);
    // the same promise is reused
    expect(await getMapContext(net)).toBe(ctx);
  });
});
