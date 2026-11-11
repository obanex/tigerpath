// OpenStreetMap -> TigerPath data.
//
// `npm run fetch-osm` runs OVERPASS_QUERY and stores the processed result in
// public/data/osm-campus.json. At startup the app loads that file (if present)
// and routes on real walkways instead of the approximate seed graph.

import { Graph } from './graph.js';
import { centroid } from './geo.js';

// Campus bounding box: south, west, north, east (generous margin).
export const CAMPUS_BBOX = [39.3800, -76.6270, 39.4030, -76.5990];

export const OVERPASS_QUERY = `
[out:json][timeout:60];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|secondary|cycleway|corridor|track)$"](${CAMPUS_BBOX.join(',')});
  way["building"](${CAMPUS_BBOX.join(',')});
  way["amenity"="parking"](${CAMPUS_BBOX.join(',')});
  node["emergency"~"^(phone|defibrillator)$"](${CAMPUS_BBOX.join(',')});
  node["entrance"](${CAMPUS_BBOX.join(',')});
);
out body;
>;
out skel qt;`;

// Unnamed houses around campus are skipped to keep the data file small.
const CAMPUS_BUILDING_TYPES = new Set(['university', 'college', 'school', 'dormitory', 'stadium', 'sports_hall', 'parking']);

const WALKABLE_EXCLUDE = (t) => t.foot === 'no' || t.access === 'private' || t.access === 'no' || t.service === 'parking_aisle' && t.foot !== 'yes';

/** Compact, JSON-friendly result. */
export function processOverpass(json) {
  const nodes = new Map();
  for (const el of json.elements) if (el.type === 'node') nodes.set(el.id, el);

  const usedNodes = new Set();
  const edges = []; // [a, b, flags]
  const buildings = [];
  const parking = [];
  const safety = [];
  const entrances = [];

  for (const el of json.elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.emergency === 'phone') safety.push({ kind: 'phone', lat: el.lat, lng: el.lon, name: t.name ?? 'Emergency phone' });
      if (t.emergency === 'defibrillator') safety.push({ kind: 'aed', lat: el.lat, lng: el.lon, name: t.name ?? 'AED', where: t['defibrillator:location'] });
      if (t.entrance) entrances.push({ id: el.id, lat: el.lat, lng: el.lon, wheelchair: t.wheelchair });
      continue;
    }
    if (el.type !== 'way' || !el.nodes) continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (t.highway && !WALKABLE_EXCLUDE(t)) {
      const flags = {};
      if (t.highway === 'steps') flags.stairs = true;
      if (t.lit === 'yes') flags.lit = true; else if (t.lit === 'no') flags.lit = false;
      if (t.wheelchair === 'no') flags.wheelchair = 'no';
      const inc = parseFloat(t.incline);
      if (!Number.isNaN(inc) && Math.abs(inc) > 8.33) flags.steep = true; // ADA ramp max 1:12
      if (t.name) flags.name = t.name;
      for (let i = 0; i + 1 < el.nodes.length; i++) {
        const a = el.nodes[i], b = el.nodes[i + 1];
        if (!nodes.has(a) || !nodes.has(b)) continue;
        usedNodes.add(a); usedNodes.add(b);
        edges.push([a, b, flags]);
      }
    } else if (t.building && pts.length > 2 && (t.name || t.ref || CAMPUS_BUILDING_TYPES.has(t.building))) {
      const c = centroid(pts.map((p) => ({ lat: p.lat, lng: p.lon })));
      buildings.push({ osmId: el.id, name: t.name ?? null, ref: t.ref ?? null, ...c,
        outline: pts.map((p) => [round(p.lat), round(p.lon)]) });
    } else if (t.amenity === 'parking' && pts.length > 2) {
      parking.push({ name: t.name ?? 'Parking', ...centroid(pts.map((p) => ({ lat: p.lat, lng: p.lon }))), access: t.access });
    }
  }

  return {
    generated: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors (ODbL)',
    nodes: [...usedNodes].map((id) => [id, round(nodes.get(id).lat), round(nodes.get(id).lon)]),
    edges,
    buildings, parking, safety, entrances,
  };
}

const round = (x) => Math.round(x * 1e7) / 1e7;

export function graphFromProcessed(data) {
  const g = new Graph();
  for (const [id, lat, lng] of data.nodes) g.addNode(String(id), lat, lng);
  for (const [a, b, flags] of data.edges) g.addEdge(String(a), String(b), flags);
  return g;
}

/**
 * Match OSM building footprints to our building list by name / ref, so we can
 * draw real outlines and correct approximate pins.
 */
export function matchBuildings(ours, osmBuildings) {
  const n = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = new Map();
  for (const b of ours) {
    const keys = [b.name, ...(b.aliases ?? [])].map(n);
    const hit = osmBuildings.find((o) => (o.ref && n(o.ref) === n(b.id)) || (o.name && keys.includes(n(o.name))));
    if (hit) matches.set(b.id, hit);
  }
  return matches;
}
