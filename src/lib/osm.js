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
  node["kerb"](${CAMPUS_BBOX.join(',')});
  node["barrier"="kerb"](${CAMPUS_BBOX.join(',')});
  node["highway"="elevator"](${CAMPUS_BBOX.join(',')});
  node["automatic_door"](${CAMPUS_BBOX.join(',')});
  node["amenity"="parking_space"]["parking_space"="disabled"](${CAMPUS_BBOX.join(',')});
);
out body;
>;
out skel qt;
(
  nwr["leisure"~"^(stadium|pitch|sports_centre|track|park)$"]["name"](${CAMPUS_BBOX.join(',')});
  nwr["amenity"~"^(clinic|doctors|cafe|fast_food|restaurant|food_court|library)$"]["name"](${CAMPUS_BBOX.join(',')});
  nwr["place"="square"](${CAMPUS_BBOX.join(',')});
  nwr["highway"="pedestrian"]["name"](${CAMPUS_BBOX.join(',')});
  way["amenity"="parking_space"]["parking_space"="disabled"](${CAMPUS_BBOX.join(',')});
);
out center tags;`;

// Unnamed houses around campus are skipped to keep the data file small.
const CAMPUS_BUILDING_TYPES = new Set(['university', 'college', 'school', 'dormitory', 'stadium', 'sports_hall', 'parking']);

const ROUGH_SURFACES = new Set(['gravel', 'fine_gravel', 'pebblestone', 'grass', 'dirt', 'earth', 'ground', 'sand', 'mud', 'unpaved', 'woodchips', 'wood_chips', 'rock', 'grass_paver']);
const BAD_SMOOTHNESS = new Set(['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable']);
const PATH_TYPES = new Set(['footway', 'path', 'pedestrian', 'steps', 'corridor', 'cycleway', 'living_street']);
const isAutomatic = (t) => (t.automatic_door && t.automatic_door !== 'no') || t.door === 'automatic';

/** Edge flags that matter for accessible / night routing, from an OSM way's tags. */
export function wayFlags(t) {
  const flags = {};
  if (t.highway === 'steps') flags.stairs = true;
  if (PATH_TYPES.has(t.highway) || t.footway === 'sidewalk') flags.path = true; // pedestrian infrastructure (vs. roads)
  if (t.lit === 'yes') flags.lit = true; else if (t.lit === 'no') flags.lit = false;
  if (['no', 'yes', 'limited'].includes(t.wheelchair)) flags.wheelchair = t.wheelchair;
  if (t.ramp === 'yes' || t['ramp:wheelchair'] === 'yes') flags.ramp = true;
  if (ROUGH_SURFACES.has(t.surface) || BAD_SMOOTHNESS.has(t.smoothness)) flags.rough = true;
  const inc = parseFloat(t.incline);
  if (!Number.isNaN(inc)) { if (Math.abs(inc) > 8.33) flags.steep = true; } // ADA ramp max 1:12
  else if ((t.incline === 'up' || t.incline === 'down') && t.highway !== 'steps') flags.sloped = true;
  if (t.name) flags.name = t.name;
  return flags;
}

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

  const pois = [];
  const access = { elevators: [], curbCuts: [], parking: [] };
  // kerbs on paths: raised kerbs block wheelchairs; unknown barrier=kerb is treated as uncertain
  const kerb = new Map();
  for (const el of json.elements) {
    const t = el.tags;
    if (el.type !== 'node' || !t) continue;
    if (t.kerb === 'raised' || t.kerb === 'rolled') kerb.set(el.id, 'raised');
    else if (t.kerb === 'lowered' || t.kerb === 'flush' || t.kerb === 'no') kerb.set(el.id, 'lowered');
    else if (t.barrier === 'kerb' && !t.kerb) kerb.set(el.id, 'unknown');
  }
  const buildingNodes = new Set();

  for (const el of json.elements) {
    const t = el.tags ?? {};
    if (el.center) { // from `out center` — named places and accessible parking areas
      if (t.amenity === 'parking_space') access.parking.push({ lat: el.center.lat, lng: el.center.lon, capacity: +t.capacity || 1 });
      else if (t.name) pois.push({ name: t.name, kind: t.leisure ?? t.amenity ?? t.place ?? t.highway, lat: el.center.lat, lng: el.center.lon });
      continue;
    }
    if (el.type === 'node' && t.name && (t.amenity || t.leisure || t.place) && t.amenity !== 'parking_space') {
      pois.push({ name: t.name, kind: t.leisure ?? t.amenity ?? t.place, lat: el.lat, lng: el.lon });
    }
    if (el.type === 'node') {
      if (t.emergency === 'phone') safety.push({ kind: 'phone', lat: el.lat, lng: el.lon, name: t.name ?? 'Emergency phone' });
      if (t.emergency === 'defibrillator') safety.push({ kind: 'aed', lat: el.lat, lng: el.lon, name: t.name ?? 'AED', where: t['defibrillator:location'] });
      if (t.entrance || isAutomatic(t)) entrances.push({ id: el.id, lat: el.lat, lng: el.lon, wheelchair: t.wheelchair, automatic: isAutomatic(t) || undefined, name: t.name ?? t.ref });
      if (t.highway === 'elevator') access.elevators.push({ id: el.id, lat: el.lat, lng: el.lon, wheelchair: t.wheelchair, level: t.level });
      if (t.amenity === 'parking_space' && t.parking_space === 'disabled') access.parking.push({ lat: el.lat, lng: el.lon, capacity: +t.capacity || 1 });
      continue;
    }
    if (el.type !== 'way' || !el.nodes) continue;
    const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (t.highway && !WALKABLE_EXCLUDE(t)) {
      const flags = wayFlags(t);
      for (let i = 0; i + 1 < el.nodes.length; i++) {
        const a = el.nodes[i], b = el.nodes[i + 1];
        if (!nodes.has(a) || !nodes.has(b)) continue;
        usedNodes.add(a); usedNodes.add(b);
        const k = kerb.get(a) === 'raised' || kerb.get(b) === 'raised' ? 'raised'
          : kerb.get(a) === 'unknown' || kerb.get(b) === 'unknown' ? 'unknown' : null;
        edges.push([a, b, k ? { ...flags, kerb: k } : flags]);
      }
    } else if (t.building && pts.length > 2 && (t.name || t.ref || CAMPUS_BUILDING_TYPES.has(t.building))) {
      el.nodes.forEach((id) => buildingNodes.add(id));
      const c = centroid(pts.map((p) => ({ lat: p.lat, lng: p.lon })));
      buildings.push({ osmId: el.id, name: t.name ?? null, ref: t.ref ?? null, ...c,
        outline: pts.map((p) => [round(p.lat), round(p.lon)]) });
    } else if (t.amenity === 'parking' && pts.length > 2) {
      const c = centroid(pts.map((p) => ({ lat: p.lat, lng: p.lon })));
      parking.push({ name: t.name ?? 'Parking', ...c, access: t.access });
      if (+t['capacity:disabled'] > 0) access.parking.push({ ...c, capacity: +t['capacity:disabled'], lot: t.name });
    }
  }
  for (const [id, k] of kerb) if (k === 'lowered' && usedNodes.has(id)) access.curbCuts.push([round(nodes.get(id).lat), round(nodes.get(id).lon)]);
  // only keep entrances on campus buildings (skips thousands of house doors)
  const campusEntrances = entrances.filter((e) => buildingNodes.has(e.id));

  return {
    generated: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors (ODbL)',
    nodes: [...usedNodes].map((id) => [id, round(nodes.get(id).lat), round(nodes.get(id).lon)]),
    edges,
    buildings, parking, safety, entrances: campusEntrances, pois, access,
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
