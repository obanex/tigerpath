#!/usr/bin/env node
// Pull Towson University's own campus map data — the public layers behind TU's
// official interactive map (maps.towson.edu, built by TU's Center for GIS) —
// and save the parts TigerPath uses:
//
//   accessible entrances, stairs, rated accessible routes, accessible parking,
//   paratransit stops, shuttle routes and stops, parking areas with permits,
//   construction areas, building codes and amenities, and the department index.
//
//   npm run fetch-tu                 # live ArcGIS services
//   npm run fetch-tu -- --from dir   # process saved GeoJSON files named <layerId>.json
//
// Output: public/data/tu-campus.json (loaded automatically by the app).
// TU publishes the data publicly "as is" and marks it preliminary/under review.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { BUILDINGS } from '../src/data/buildings.js';

const BASE = 'https://services1.arcgis.com/ZwA0Q1mheCEc5yXS/arcgis/rest/services';
const LAYERS = {
  accessParking: ['TU_Campus_Map_Accessibility', 100],
  paratransit: ['TU_Campus_Map_Accessibility', 101],
  stairs: ['TU_Campus_Map_Accessibility', 102],
  entrances: ['TU_Campus_Map_Accessibility', 103],
  accessRoutes: ['TU_Campus_Map_Accessibility', 104],
  ev: ['TU_Campus_Map_Parking', 500],
  visitor: ['TU_Campus_Map_Parking', 503],
  parkingAreas: ['TU_Campus_Map_Parking', 201],
  construction: ['TU_Campus_Map_Construction_Areas', 300],
  buildings: ['TU_Campus_Map_Building_and_Garage_Footprints', 200],
  departments: ['TU_Department_Search', 0],
  ...Object.fromEntries([600, 601, 602, 603, 604, 605].map((id) => [`stops${id}`, ['TU_Campus_Map_Transit', id]])),
  ...Object.fromEntries([606, 607, 608, 609, 610, 611].map((id) => [`route${id}`, ['TU_Campus_Map_Transit', id]])),
};

const args = process.argv.slice(2);
const fromDir = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;

async function layer(key) {
  const [service, id] = LAYERS[key];
  if (fromDir) return JSON.parse(await readFile(`${fromDir}/${id}.json`, 'utf8')).features;
  const url = `${BASE}/${service}/FeatureServer/${id}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'TigerPath campus map data fetch' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      if (json.properties?.exceededTransferLimit) throw new Error('layer too large for one request');
      return json.features;
    } catch (err) {
      if (attempt >= 2) throw new Error(`${service}/${id}: ${err.message}`);
      console.log(`  ${service}/${id} failed (${err.message}), retrying …`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
}

// ---------- helpers
const r5 = (x) => Math.round(x * 1e5) / 1e5; // ~1 m
const pt = (f) => { const [lng, lat] = f.geometry.coordinates; return { lat: r5(lat), lng: r5(lng) }; };
const line = (coords) => coords.map(([lng, lat]) => [r5(lat), r5(lng)]);
const lines = (g) => !g ? [] : g.type === 'LineString' ? [line(g.coordinates)] : g.type === 'MultiLineString' ? g.coordinates.map(line) : [];
const ring = (g) => !g ? null : g.type === 'Polygon' ? line(g.coordinates[0]) : g.type === 'MultiPolygon' ? line(g.coordinates.sort((a, b) => b[0].length - a[0].length)[0][0]) : null;
function centroid(poly) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][1] * poly[i][0] - poly[i][1] * poly[j][0];
    a += f; x += (poly[j][1] + poly[i][1]) * f; y += (poly[j][0] + poly[i][0]) * f;
  }
  if (!a) return { lat: poly[0][0], lng: poly[0][1] };
  return { lat: r5(y / (3 * a)), lng: r5(x / (3 * a)) };
}
const clean = (s) => (typeof s === 'string' ? s.trim() : s) || undefined;
const norm = (s) => (s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- building matching (TU name -> TigerPath id)
// Names that differ between TU's map and TigerPath. Everything else matches by name.
const NAME_TO_ID = {
  'cook library': 'CK', 'liberal arts': 'LA', 'health professions': 'HP', 'ward and west': 'WW',
  'glen tower a': 'GT', 'glen tower b': 'GT', 'glen tower c': 'GT', 'glen tower d': 'GT',
  'towson run': 'TRA', 'newell dining': 'NDH', 'glen dining': 'GDH', 'secu arena': 'AR', 'tigers arena': 'AR',
  'enrollment services': 'ES', '10 west burke': 'TM', 'johnny unitas stadium': 'US',
};
// TU uses both names for the Armory (StarTUp's home).
const SAME = { 'towson armory': 'the armory' };
const ourByName = new Map();
for (const b of BUILDINGS) for (const n of [b.name, ...(b.aliases ?? [])]) if (!ourByName.has(norm(n))) ourByName.set(norm(n), b.id);
const matchId = (name) => NAME_TO_ID[norm(name)] ?? ourByName.get(norm(name)) ?? null;
const extraId = (name) => out.extraBuildings.find((b) => norm(b.name) === (SAME[norm(name)] ?? norm(name)))?.id;

const CATEGORY = { 'Residence Buildings': 'residence' };

// ---------- main
console.log('Fetching TU campus map layers …');
const L = {};
for (const key of Object.keys(LAYERS)) L[key] = await layer(key);

const out = {
  source: 'Towson University Center for GIS — public campus map layers (maps.towson.edu)',
  fetched: new Date().toISOString().slice(0, 10),
  buildings: {}, extraBuildings: [], departments: [], entrances: [], stairs: [], accessRoutes: [],
  accessParking: [], paratransit: [], shuttles: [], parking: [], construction: [],
};

// Buildings: official codes, all-gender restrooms, lactation rooms. Unmatched named
// buildings become extra (searchable) buildings.
const unmatched = [];
for (const f of L.buildings) {
  const p = f.properties;
  if (!p.Name || p.Hide === 'Yes') continue;
  const id = matchId(p.Name);
  const info = { code: clean(p.Abbreviation), name: p.Name, address: clean(p.Address), restrooms: clean(p.AllGenderRestrooms), lactation: clean(p.LactationRooms) };
  if (id) {
    const prev = out.buildings[id];
    if (prev) { // several TU footprints for one TigerPath building (Glen Towers A–D)
      prev.parts = [...(prev.parts ?? [prev.name]), p.Name];
      for (const k of ['restrooms', 'lactation']) if (info[k]) prev[k] = [prev[k], `${p.Name}: ${info[k]}`].filter(Boolean).join('; ');
    } else out.buildings[id] = info;
  } else {
    const poly = ring(f.geometry);
    if (!poly) continue;
    unmatched.push(p.Name);
    const category = /tennis|soccer|softball|hockey|stadium|field/i.test(p.Name) ? 'athletics' : CATEGORY[p.BuildingType] === 'residence' ? 'residence' : 'services';
    out.extraBuildings.push({ ...info, id: `tu-${info.code ?? p.UniqueID}`, category, ...centroid(poly) });
  }
}

// Department search: which office is in which building.
const seen = new Set();
for (const f of L.departments) {
  const p = f.properties;
  const name = clean(p.Department);
  if (!name) continue;
  const building = matchId(p.BuildingName) ?? extraId(p.BuildingName);
  if (!building) continue;
  const k = `${building}|${name}`;
  if (seen.has(k)) continue;
  seen.add(k);
  out.departments.push({ name, building, link: clean(p.Link), aliases: [p.DepartmentVariant1, p.DepartmentVariant2].map(clean).filter(Boolean) });
}

for (const f of L.entrances) {
  const p = f.properties;
  out.entrances.push({ ...pt(f), building: matchId(p.BuildingName) ?? extraId(p.BuildingName) ?? null,
    buildingName: p.BuildingName, name: clean(p.Name), door: clean(p.DoorType), opener: p.PushPaddle === 'Yes',
    steps: p.ExteriorStairs === 'Yes', note: clean(p.EntranceChallenges) ?? clean(p.FieldNotes) });
}
out.stairs = L.stairs.filter((f) => f.geometry).map((f) => { const { lat, lng } = pt(f); return [lat, lng]; });
const RATING = { Accessible: 'yes', 'Limited Accessibility': 'limited', 'Not Accessible': 'no' };
for (const f of L.accessRoutes) {
  const rating = RATING[f.properties.AccessibleRating];
  if (rating) for (const l of lines(f.geometry)) out.accessRoutes.push({ rating, line: l });
}
for (const f of L.accessParking) {
  const p = f.properties;
  if (p.Visible === 'No') continue;
  out.accessParking.push({ ...pt(f), name: clean(p.Name), lot: clean(p.GarageLotName), spaces: p.AccessibleSpaces ?? null, floor: p.GarageFloor && p.GarageFloor !== 'Not applicable' ? p.GarageFloor : undefined });
}
for (const f of L.paratransit) if (f.properties.Visible !== 'No') out.paratransit.push({ ...pt(f), name: clean(f.properties.Name) });

// Shuttles: one route line + its stops per line.
const SHUTTLE = [
  [606, 600, 'West Village Core Campus', '#2563eb'], [607, 601, 'Stadium Core Campus', '#16a34a'],
  [611, 605, 'Gold', '#e0a100'], [608, 602, 'Lake Avenue', '#9333ea'],
  [609, 603, 'Kenilworth', '#dc2626'], [610, 604, 'Goucher / Loch Raven', '#0891b2'],
];
for (const [routeId, stopsId, name, color] of SHUTTLE) {
  const route = L[`route${routeId}`];
  out.shuttles.push({ id: `tu-${routeId}`, name, color, lines: route.flatMap((f) => lines(f.geometry)),
    stops: L[`stops${stopsId}`].map((f) => ({ ...pt(f), name: clean(f.properties.Name) })) });
}

// Parking areas with permits, plus visitor / EV / accessible counts from the point layers.
const PERMIT = { C: 'core', F: 'faculty-staff', O: 'overflow', R: 'resident' };
const byLot = (list, lot) => list.filter((f) => norm(f.properties.GarageLotName) === norm(lot));
const sum = (fs, k) => fs.reduce((s, f) => s + (Number(f.properties[k]) || 0), 0);
for (const f of L.parkingAreas) {
  const p = f.properties;
  const poly = ring(f.geometry);
  if (!poly) continue;
  const visitor = sum(byLot(L.visitor, p.Name), 'VisitorSpaces');
  const permits = (p.Permits ?? '').split(/[,\s]+/).map((x) => PERMIT[x]).filter(Boolean);
  if (visitor) permits.push('visitor');
  const id = `P-${p.Abbreviation ?? p.UniqueID}`;
  if (out.parking.some((q) => q.name === p.Name)) { // Lot 17 is split in four parts: keep one marker
    const q = out.parking.find((x) => x.name === p.Name);
    q.spaces = (q.spaces ?? 0) + (Number(String(p.ParkingSpaces ?? '').replace(/,/g, '')) || 0);
    continue;
  }
  out.parking.push({
    id, name: p.Name, code: clean(p.Abbreviation), kind: /garage/i.test(p.BuildingType ?? p.Name) ? 'garage' : 'lot',
    permits, spaces: Number(String(p.ParkingSpaces ?? '').replace(/,/g, '')) || null, address: clean(p.Address),
    visitor: visitor || undefined, ev: sum(byLot(L.ev, p.Name), 'EVChargingSpaces') || undefined,
    accessible: sum(byLot(L.accessParking, p.Name), 'AccessibleSpaces') || undefined,
    ...centroid(poly), outline: poly,
  });
}

for (const f of L.construction) {
  const p = f.properties;
  const poly = ring(f.geometry);
  if (!poly) continue;
  const year = String(p.OpenDate ?? '').match(/\d{4}/)?.[0];
  out.construction.push({ name: clean(p.Name), opens: clean(String(p.OpenDate ?? '')), until: year ? `${year}-12-31` : null, polygon: poly, link: clean(p.Link) });
}

await mkdir('public/data', { recursive: true });
await writeFile('public/data/tu-campus.json', JSON.stringify(out));
const size = (await readFile('public/data/tu-campus.json')).length;
console.log(`Saved public/data/tu-campus.json (${(size / 1024).toFixed(0)} KB):`);
for (const [k, v] of Object.entries(out)) if (typeof v === 'object') console.log(`  ${k}: ${Array.isArray(v) ? v.length : Object.keys(v).length}`);
console.log(`  TU buildings not in TigerPath (added as extra buildings): ${unmatched.join(', ') || 'none'}`);
const noDoor = out.entrances.filter((e) => !e.building).map((e) => e.buildingName);
if (noDoor.length) console.log(`  Entrances with no matching building: ${[...new Set(noDoor)].join(', ')}`);
