// Bake the Waterloo OSM snapshot used by loadWaterloo().
//
//   node scripts/bake-waterloo.mjs            fetch from Overpass, save raw + converted
//   node scripts/bake-waterloo.mjs --offline  re-convert scripts/data/waterloo-overpass.json
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
const offline = process.argv.includes('--offline');

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function loadConverter() {
  const res = await build({
    stdin: {
      contents: `export { convertOverpass, overpassQuery, junctionCount } from './src/net/osm';
                 export { applyWaterlooZones, WATERLOO_BBOX } from './src/net/waterlooZones';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
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

let net = m.convertOverpass(raw, m.WATERLOO_BBOX, { id: 'waterloo', name: 'Waterloo — Uptown & UW (OSM)', maxJunctions: 80 });
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
