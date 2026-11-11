#!/usr/bin/env node
// Pull real walkways, building footprints, parking and emergency phones for the
// Towson campus from OpenStreetMap and save them for the app.
//
//   npm run fetch-osm                      # live Overpass API
//   npm run fetch-osm -- --from file.json  # process a saved Overpass response
//
// Output: public/data/osm-campus.json (loaded automatically by the app).

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { OVERPASS_QUERY, processOverpass } from '../src/lib/osm.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      console.log(`Querying ${url} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TigerPath campus map data fetch' },
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed. Try again later or use --from <file>.');
}

const fromIdx = process.argv.indexOf('--from');
const raw = fromIdx > -1 ? JSON.parse(await readFile(process.argv[fromIdx + 1], 'utf8')) : await fetchOverpass();
const data = processOverpass(raw);
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/data/osm-campus.json', import.meta.url), JSON.stringify(data));
if (process.argv.includes('--raw')) await writeFile(new URL('../osm-raw.json', import.meta.url), JSON.stringify(raw));
console.log(`Saved public/data/osm-campus.json: ${data.nodes.length} path nodes, ${data.edges.length} edges, ` +
  `${data.buildings.length} buildings (${data.buildings.filter((b) => b.name).length} named), ` +
  `${data.safety.length} safety features, ${data.parking.length} parking areas.`);
