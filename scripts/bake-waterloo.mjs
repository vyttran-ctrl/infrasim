// Bake the Waterloo OSM snapshot used by loadWaterloo() and the building
// footprints used by the renderer (loadWaterlooBuildings()).
//
//   node scripts/bake-waterloo.mjs            fetch roads + buildings from Overpass, save raw + converted
//   node scripts/bake-waterloo.mjs --offline  re-convert scripts/data/waterloo-*.json
//
// The converter is TypeScript (src/net/osm.ts); it is bundled on the fly with
// the esbuild that ships with Vite, so no extra tooling is needed.

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawPath = resolve(root, 'scripts/data/waterloo-overpass.json');
const outPath = resolve(root, 'src/net/waterloo.json');
const rawBuildingsPath = resolve(root, 'scripts/data/waterloo-buildings-overpass.json');
const outBuildingsPath = resolve(root, 'src/net/waterlooBuildings.json');
const rawBasemapPath = resolve(root, 'scripts/data/waterloo-basemap-overpass.json');
const outBasemapPath = resolve(root, 'src/net/waterlooBasemap.json');

/** Max simulated junctions: the main grid plus the residential collectors. */
const MAX_JUNCTIONS = 120;
/** Local streets that matter for traffic in Uptown / around campus, kept whatever their OSM class. */
const KEEP_NAMES = ['Lester Street', 'Hazel Street', 'Phillip Street', 'Seagram Drive', 'Albert Street', 'Regina Street', 'Caroline Street', 'Erb Street', 'Bridgeport Road', 'Columbia Street', 'Westmount Road', 'University Avenue', 'King Street', 'Weber Street'];
const offline = process.argv.includes('--offline');

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function loadConverter() {
  const res = await build({
    stdin: {
      contents: `export { convertOverpass, overpassQuery, junctionCount } from './src/net/osm';
                 export { applyWaterlooZones, waterlooUntypedHeight, WATERLOO_BBOX } from './src/net/waterlooZones';
                 export { buildingsQuery, convertBuildings, packBuildings } from './src/net/buildings';
                 export { basemapQuery, convertBasemap, packBasemap } from './src/net/basemap';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['*.json'], // baked outputs are only needed at runtime
    write: false,
  });
  const file = resolve(tmpdir(), `infrasim-bake-${process.pid}.mjs`);
  await writeFile(file, res.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

async function fetchOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`POST ${url}`);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'InfraSim-bake/0.1' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(90_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.elements?.length) throw new Error('empty result');
        return json;
      } catch (e) {
        lastErr = e;
        console.warn(`  failed: ${e.message}`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }
  throw lastErr;
}

const m = await loadConverter();
let raw;
if (offline) {
  raw = JSON.parse(await readFile(rawPath, 'utf8'));
} else {
  raw = await fetchOverpass(m.overpassQuery(m.WATERLOO_BBOX));
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify(raw));
  console.log(`saved ${raw.elements.length} elements → ${rawPath}`);
}

// Raw basemap features, trimmed to the tags the converter reads.
const KEEP_TAGS = ['highway', 'railway', 'waterway', 'leisure', 'landuse', 'natural', 'amenity', 'parking', 'service', 'footway', 'area', 'indoor', 'level', 'tunnel', 'name'];
const BUILDING_TAGS = ['building', 'height', 'building:height', 'building:levels', 'roof:levels', 'location', 'layer'];
function trim(el, keys) {
  const tags = {};
  for (const k of keys) if (el.tags?.[k] !== undefined) tags[k] = el.tags[k];
  const geom = (g) => g?.map((p) => ({ lat: p.lat, lon: p.lon }));
  return { type: el.type, id: el.id, tags, ...(el.geometry ? { geometry: geom(el.geometry) } : {}), ...(el.members ? { members: el.members.filter((x) => x.type === 'way').map((x) => ({ type: x.type, role: x.role, geometry: geom(x.geometry) })) } : {}) };
}
let rawB;
if (offline) {
  rawB = JSON.parse(await readFile(rawBuildingsPath, 'utf8'));
} else {
  await new Promise((res) => setTimeout(res, 5000)); // be polite to Overpass
  rawB = await fetchOverpass(m.buildingsQuery(m.WATERLOO_BBOX));
  rawB = { elements: rawB.elements.map((e) => trim(e, BUILDING_TAGS)) };
  await writeFile(rawBuildingsPath, JSON.stringify(rawB));
  console.log(`saved ${rawB.elements.length} building elements → ${rawBuildingsPath}`);
}

let rawM;
if (offline) {
  rawM = JSON.parse(await readFile(rawBasemapPath, 'utf8'));
} else {
  await new Promise((res) => setTimeout(res, 5000));
  rawM = await fetchOverpass(m.basemapQuery(m.WATERLOO_BBOX));
  rawM = { elements: rawM.elements.filter((e) => e.type !== 'node').map((e) => trim(e, KEEP_TAGS)) };
  await writeFile(rawBasemapPath, JSON.stringify(rawM));
  console.log(`saved ${rawM.elements.length} basemap elements → ${rawBasemapPath}`);
}

let net = m.convertOverpass(raw, m.WATERLOO_BBOX, { id: 'waterloo', name: 'Waterloo — Uptown & UW (OSM)', maxJunctions: MAX_JUNCTIONS, keepNames: KEEP_NAMES });
net = m.applyWaterlooZones(net, m.WATERLOO_BBOX);
await writeFile(outPath, JSON.stringify(net));

const kinds = {};
for (const n of net.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
const names = [...new Set(net.edges.map((e) => e.name))].sort();
console.log(`nodes ${net.nodes.length} (junctions ${m.junctionCount(net)}) edges ${net.edges.length} signals ${net.signals.length}`);
console.log('kinds', kinds);
console.log('zones', net.zones.map((z) => `${z.name}:${z.nodes.length}`).join(', '));
console.log('streets', names.join(' | '));
console.log(`wrote ${outPath}`);

const buildings = m.convertBuildings(rawB, m.WATERLOO_BBOX, { untypedDefault: m.waterlooUntypedHeight(m.WATERLOO_BBOX) });
const packed = JSON.stringify(m.packBuildings(buildings));
await writeFile(outBuildingsPath, packed);
const verts = buildings.reduce((s, b) => s + b.pts.length, 0);
const basemap = m.convertBasemap(rawM, m.WATERLOO_BBOX);
const packedM = JSON.stringify(m.packBasemap(basemap));
await writeFile(outBasemapPath, packedM);
console.log(`basemap areas ${basemap.areas.length} lines ${basemap.lines.length} labels ${basemap.labels.map((l) => l.text).join(', ')} (${(packedM.length / 1024).toFixed(0)} KiB) → ${outBasemapPath}`);
console.log(`buildings ${buildings.length} (${verts} vertices, ${(packed.length / 1024).toFixed(0)} KiB) → ${outBuildingsPath}`);
