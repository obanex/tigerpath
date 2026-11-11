import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, turnAngle } from '../src/lib/geo.js';
import { Graph, buildSeedGraph, route, directions } from '../src/lib/graph.js';
import { createIndex, search, parseRoom } from '../src/lib/search.js';
import { openStatus } from '../src/lib/hours.js';
import { planDay, toICS } from '../src/lib/schedule.js';
import { processOverpass, graphFromProcessed, matchBuildings } from '../src/lib/osm.js';
import { BUILDINGS } from '../src/data/buildings.js';

test('distance is sane at campus scale', () => {
  const d = distance({ lat: 39.39, lng: -76.61 }, { lat: 39.40, lng: -76.61 });
  assert.ok(Math.abs(d - 1112) < 5, `got ${d}`);
  assert.equal(turnAngle(350, 10), 20);
  assert.equal(turnAngle(10, 350), -20);
});

test('seed graph connects every building', () => {
  const g = buildSeedGraph(BUILDINGS.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, label: b.name })));
  for (const b of BUILDINGS) {
    const r = route(g, 'AD', b.id);
    assert.ok(r, `no route AD -> ${b.id}`);
  }
});

test('A* finds shortest path and accessible mode avoids stairs', () => {
  const g = new Graph();
  // A --(stairs, short)-- B ; A -- C -- B (longer, step-free)
  g.addNode('A', 39.390, -76.610); g.addNode('B', 39.391, -76.610); g.addNode('C', 39.3905, -76.6095);
  g.addEdge('A', 'B', { stairs: true }); g.addEdge('A', 'C'); g.addEdge('C', 'B');
  assert.deepEqual(route(g, 'A', 'B', 'standard').path, ['A', 'B']);
  assert.deepEqual(route(g, 'A', 'B', 'accessible').path, ['A', 'C', 'B']);
  g.setEdgeFlags('C', 'B', { closed: true });
  assert.equal(route(g, 'A', 'B', 'accessible'), null);
});

test('night profile prefers lit paths', () => {
  const g = new Graph();
  g.addNode('A', 39.390, -76.610); g.addNode('B', 39.391, -76.610); g.addNode('C', 39.3905, -76.6097);
  g.addEdge('A', 'B', { lit: false }); g.addEdge('A', 'C', { lit: true }); g.addEdge('C', 'B', { lit: true });
  assert.deepEqual(route(g, 'A', 'B', 'standard').path, ['A', 'B']);
  assert.deepEqual(route(g, 'A', 'B', 'night').path, ['A', 'C', 'B']);
});

test('directions produce depart / turn / arrive', () => {
  const g = new Graph();
  g.addNode('A', 39.390, -76.610); g.addNode('B', 39.391, -76.610, 'Mid'); g.addNode('C', 39.391, -76.608);
  g.addEdge('A', 'B'); g.addEdge('B', 'C');
  const steps = directions(g, route(g, 'A', 'C'), { fromLabel: 'Start', toLabel: 'End' });
  assert.match(steps[0].text, /^Head north from Start/);
  assert.match(steps[1].text, /^Turn right/);
  assert.equal(steps.at(-1).text, 'Arrive at End');
});

test('search: codes, names, aliases, departments, typos, rooms', () => {
  const idx = createIndex(BUILDINGS);
  assert.equal(search(idx, 'LA')[0].item.id, 'LA');
  assert.equal(search(idx, 'cook')[0].item.id, 'CK');
  assert.equal(search(idx, 'library')[0].item.id, 'CK');
  assert.equal(search(idx, 'registrar')[0].item.id, 'ES');
  assert.equal(search(idx, 'computer science')[0].item.id, 'YR');
  assert.equal(search(idx, 'stephns')[0].item.id, 'ST');
  const r = search(idx, 'la 4310')[0];
  assert.equal(r.item.id, 'LA'); assert.equal(r.room.floor, 4);
  assert.deepEqual(parseRoom('ST-102b'), { code: 'ST', room: '102B', floor: 1 });
  assert.equal(search(idx, 'chick fil a')[0].item.id, 'UU');
  assert.equal(search(idx, 'health center')[0].item.id, 'WW');
  assert.equal(search(idx, 'paca')[0].item.id, 'WV1');
  assert.equal(search(idx, 'zzzz').length, 0);
});

test('hours: open, closed, past-midnight', () => {
  const h = { mon: '08:00-17:00', fri: '18:00-02:00' };
  // 2026-11-09 is a Monday
  assert.equal(openStatus(h, new Date(2026, 10, 9, 9, 0)).open, true);
  assert.match(openStatus(h, new Date(2026, 10, 9, 18, 0)).label, /opens Fri 6pm/);
  assert.equal(openStatus(h, new Date(2026, 10, 14, 1, 0)).open, true); // Sat 1am, from Fri night
  assert.equal(openStatus(null).open, null);
});

test('schedule: flags tight and late transitions; ICS export', () => {
  const classes = [
    { id: '1', title: 'COSC 236', building: 'YR', room: '125', days: ['mon'], start: '09:00', end: '09:50' },
    { id: '2', title: 'ENGL 102', building: 'LA', room: '4310', days: ['mon'], start: '10:00', end: '10:50' },
    { id: '3', title: 'BIOL 190', building: 'SC', room: '201', days: ['mon'], start: '10:55', end: '11:45' },
  ];
  const walk = (a, b) => ({ 'YR>LA': 8, 'LA>SC': 8 })[`${a}>${b}`];
  const { legs } = planDay(classes, 'mon', walk);
  assert.deepEqual(legs.map((l) => l.status), ['tight', 'late']);
  const ics = toICS(classes, { termStart: '2027-01-25', termEnd: '2027-05-14', now: new Date(0) });
  assert.match(ics, /DTSTART:20270125T090000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270514T235959/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('OSM processing builds a routable graph with flags', () => {
  const json = { elements: [
    { type: 'node', id: 1, lat: 39.390, lon: -76.610 },
    { type: 'node', id: 2, lat: 39.391, lon: -76.610 },
    { type: 'node', id: 3, lat: 39.3905, lon: -76.6095 },
    { type: 'node', id: 9, lat: 39.3906, lon: -76.6096, tags: { emergency: 'phone' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'steps' } },
    { type: 'way', id: 11, nodes: [1, 3, 2], tags: { highway: 'footway', lit: 'yes', name: 'Tiger Walk' } },
    { type: 'way', id: 12, nodes: [1, 2, 3, 1], tags: { building: 'yes', name: 'Stephens Hall' } },
    { type: 'way', id: 13, nodes: [1, 2], tags: { highway: 'service', access: 'private' } },
  ] };
  const data = JSON.parse(JSON.stringify(processOverpass(json)));
  assert.equal(data.safety.length, 1);
  assert.equal(data.edges.length, 3);
  const g = graphFromProcessed(data);
  assert.deepEqual(route(g, '1', '2', 'accessible').path, ['1', '3', '2']);
  assert.equal(route(g, '1', '2', 'accessible').edges[0].name, 'Tiger Walk');
  assert.equal(matchBuildings(BUILDINGS, data.buildings).get('ST').osmId, 12);
});

test('editor patches building coordinates in source text', async () => {
  const { patchSource } = await import('../src/lib/patch.js');
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/data/buildings.js', import.meta.url), 'utf8');
  const out = patchSource(src, { LA: { lat: 39.1, lng: -76.2 }, CK: { lat: 39.3, lng: -76.4 } });
  const mod = await import('data:text/javascript,' + encodeURIComponent(out));
  const by = Object.fromEntries(mod.BUILDINGS.map((b) => [b.id, b]));
  assert.deepEqual([by.LA.lat, by.LA.lng, by.CK.lat, by.CK.lng], [39.1, -76.2, 39.3, -76.4]);
  assert.equal(by.HH.lat, 39.39412); // untouched
});

test('OSM processing keeps named places from `out center`', () => {
  const data = processOverpass({ elements: [
    { type: 'way', id: 5, center: { lat: 39.388, lon: -76.615 }, tags: { leisure: 'stadium', name: 'Johnny Unitas Stadium' } },
    { type: 'node', id: 6, lat: 39.39, lon: -76.61, tags: { amenity: 'cafe', name: 'Campus Cafe' } },
  ] });
  assert.deepEqual(data.pois.map((p) => p.name), ['Johnny Unitas Stadium', 'Campus Cafe']);
});

test('mainComponent returns the largest connected piece', () => {
  const g = new Graph();
  for (const [id, lat] of [['a', 39.39], ['b', 39.391], ['c', 39.392], ['x', 39.40], ['y', 39.401]]) g.addNode(id, lat, -76.61);
  g.addEdge('a', 'b'); g.addEdge('b', 'c'); g.addEdge('x', 'y');
  assert.deepEqual([...g.mainComponent()].sort(), ['a', 'b', 'c']);
});

test('directions fold tiny kinks into meaningful steps', () => {
  const g = new Graph();
  // 200 m north with a 3 m sideways jog in the middle, then 100 m east
  const pts = [[39.3900, -76.6100], [39.3909, -76.6100], [39.3909, -76.61003], [39.3918, -76.61003], [39.3918, -76.6088]];
  pts.forEach(([lat, lng], i) => g.addNode(String(i), lat, lng));
  for (let i = 0; i + 1 < pts.length; i++) g.addEdge(String(i), String(i + 1));
  const steps = directions(g, route(g, '0', '4'), { toLabel: 'X' });
  assert.equal(steps.length, 3, steps.map((s) => s.text).join(' | '));
  assert.match(steps[1].text, /^Turn right/);
});

test('OSM accessibility: ramps, kerbs, elevators, entrances, accessible parking', async () => {
  const { wayFlags } = await import('../src/lib/osm.js');
  assert.deepEqual(wayFlags({ highway: 'footway', ramp: 'yes', surface: 'gravel', incline: '10%' }), { path: true, ramp: true, rough: true, steep: true });
  assert.deepEqual(wayFlags({ highway: 'footway', incline: 'up', wheelchair: 'yes' }), { path: true, wheelchair: 'yes', sloped: true });
  assert.deepEqual(wayFlags({ highway: 'residential', name: 'Osler Drive' }), { name: 'Osler Drive' });
  const data = processOverpass({ elements: [
    { type: 'node', id: 1, lat: 39.390, lon: -76.610 },
    { type: 'node', id: 2, lat: 39.391, lon: -76.610, tags: { kerb: 'raised' } },
    { type: 'node', id: 3, lat: 39.3905, lon: -76.6095, tags: { kerb: 'lowered' } },
    { type: 'node', id: 4, lat: 39.3906, lon: -76.6090, tags: { entrance: 'main', wheelchair: 'yes', automatic_door: 'button' } },
    { type: 'node', id: 5, lat: 39.3907, lon: -76.6091 },
    { type: 'node', id: 6, lat: 39.3908, lon: -76.6092, tags: { entrance: 'yes' } }, // not on a campus building
    { type: 'node', id: 7, lat: 39.3909, lon: -76.6093, tags: { highway: 'elevator' } },
    { type: 'node', id: 8, lat: 39.3910, lon: -76.6094, tags: { amenity: 'parking_space', parking_space: 'disabled', capacity: '2' } },
    { type: 'node', id: 9, lat: 39.392, lon: -76.610 },
    { type: 'way', id: 10, nodes: [1, 2, 9], tags: { highway: 'footway' } },
    { type: 'way', id: 11, nodes: [1, 3, 9], tags: { highway: 'footway', ramp: 'yes' } },
    { type: 'way', id: 12, nodes: [4, 5, 1, 4], tags: { building: 'university', name: 'Test Hall' } },
  ] });
  assert.equal(data.edges.find(([a, b]) => a === 1 && b === 2)[2].kerb, 'raised');
  assert.deepEqual(data.access.curbCuts, [[39.3905, -76.6095]]);
  assert.deepEqual(data.entrances.map((e) => [e.id, e.wheelchair, e.automatic]), [[4, 'yes', true]]);
  assert.equal(data.access.elevators.length, 1);
  assert.equal(data.access.parking[0].capacity, 2);
  const g = graphFromProcessed(data);
  assert.deepEqual(route(g, '1', '9', 'standard').path, ['1', '2', '9']);
  assert.deepEqual(route(g, '1', '9', 'accessible').path, ['1', '3', '9']); // ramp + curb cut, not the raised kerb
});

test('route options: fastest, a different way, step-free; duplicates merged', async () => {
  const { routeOptions } = await import('../src/lib/alternatives.js');
  // grid: short way A-B-D has stairs; C route around is longer but step-free; E is a parallel lit street
  const g = new Graph();
  const P = { A: [39.390, -76.610], B: [39.391, -76.610], D: [39.392, -76.610], C: [39.391, -76.6088], E: [39.391, -76.6106] };
  for (const [id, [lat, lng]] of Object.entries(P)) g.addNode(id, lat, lng);
  g.addEdge('A', 'B'); g.addEdge('B', 'D', { stairs: true });
  g.addEdge('A', 'C', { name: 'Ramp Walk' }); g.addEdge('C', 'D', { name: 'Ramp Walk' });
  g.addEdge('A', 'E', { lit: true, name: 'Lit Lane' }); g.addEdge('E', 'D', { lit: true, name: 'Lit Lane' });
  const compute = (profile, extra = {}) => { const res = route(g, 'A', 'D', profile, extra); return res && { res, minutes: res.dist / 1.34 / 60 }; };
  const opts = routeOptions(compute);
  const kinds = opts.map((o) => [o.kind, ...o.also].join('+'));
  assert.equal(opts[0].kind, 'fastest');
  assert.ok(opts[0].badges.includes('Quickest'));
  assert.equal(opts[0].stairs, 1);
  assert.ok(opts.some((o) => o.badges.includes('No stairs')), kinds.join(','));
  assert.ok(opts.find((o) => o.kind === 'lit' || o.also.includes('lit')).via === 'Lit Lane', JSON.stringify(opts.map((o) => [o.kind, o.via])));
  // stairs avoided entirely when the student asks for it
  assert.equal(route(g, 'A', 'D', 'standard', { noStairs: true }).edges.some((e) => e.stairs), false);
});

test('sunrise/sunset for Towson', async () => {
  const { sunTimes, isDarkOutside } = await import('../src/lib/sun.js');
  const nov = sunTimes(new Date(2026, 10, 11, 12), 39.3925, -76.611);
  // published: sunrise ≈ 11:46 UTC (6:46am EST), sunset ≈ 21:53 UTC (4:53pm EST)
  assert.ok(Math.abs(nov.sunset - Date.UTC(2026, 10, 11, 21, 53)) < 6 * 60000, nov.sunset.toISOString());
  assert.ok(Math.abs(nov.sunrise - Date.UTC(2026, 10, 11, 11, 46)) < 6 * 60000, nov.sunrise.toISOString());
  const jun = sunTimes(new Date(2026, 5, 21, 12), 39.3925, -76.611);
  assert.ok(Math.abs(jun.sunset - Date.UTC(2026, 5, 22, 0, 37)) < 6 * 60000, jun.sunset.toISOString()); // 8:37pm EDT
  assert.equal(isDarkOutside(new Date(Date.UTC(2026, 10, 11, 23, 0))), true);
  assert.equal(isDarkOutside(new Date(Date.UTC(2026, 10, 11, 17, 0))), false);
});
