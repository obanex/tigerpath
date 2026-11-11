#!/usr/bin/env node
// Turn a PMTiles extract of the Towson area into plain tile files that any
// static host (GitHub Pages, Cloudflare Pages, a towson.edu server) can serve:
//
//   public/tiles/{z}/{x}/{y}.mvt   vector tiles, uncompressed
//   public/tiles/meta.json         bounds, zoom range, source build date
//
// Usage: node scripts/build-basemap.mjs basemap.pmtiles [build-date]
// (The "Build self-hosted map" workflow makes the extract with the pmtiles CLI.)

import { open, mkdir, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PMTiles } from 'pmtiles';

const [file, buildDate = null] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/build-basemap.mjs <extract.pmtiles> [build-date]'); process.exit(1); }

class FileSource {
  constructor(path) { this.path = path; this.fh = null; }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    this.fh ??= await open(this.path, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }
}

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };

const src = new FileSource(file);
const pm = new PMTiles(src);
const h = await pm.getHeader();
const out = new URL('../public/tiles/', import.meta.url);
await rm(out, { recursive: true, force: true });

let count = 0, bytes = 0;
for (let z = h.minZoom; z <= h.maxZoom; z++) {
  const [x0, x1] = [lon2x(h.minLon, z), lon2x(h.maxLon, z)];
  const [y0, y1] = [lat2y(h.maxLat, z), lat2y(h.minLat, z)];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const t = await pm.getZxy(z, x, y);
      if (!t?.data) continue;
      let data = Buffer.from(t.data);
      if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data); // static hosts can't add Content-Encoding
      await mkdir(new URL(`${z}/${x}/`, out), { recursive: true });
      await writeFile(new URL(`${z}/${x}/${y}.mvt`, out), data);
      count++; bytes += data.length;
    }
  }
}
const meta = {
  bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat].map((v) => Math.round(v * 1e5) / 1e5),
  minzoom: h.minZoom, maxzoom: h.maxZoom,
  build: buildDate, generated: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors · Protomaps',
};
await writeFile(new URL('meta.json', out), JSON.stringify(meta, null, 2) + '\n');
await src.fh?.close();
console.log(`Wrote ${count} tiles (${(bytes / 1e6).toFixed(1)} MB) for zoom ${h.minZoom}–${h.maxZoom}, bounds ${meta.bounds.join(', ')}`);
