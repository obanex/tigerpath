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
  assert.equal(by.HH.lat, 39.3941); // untouched
});

test('OSM processing keeps named places from `out center`', () => {
  const data = processOverpass({ elements: [
    { type: 'way', id: 5, center: { lat: 39.388, lon: -76.615 }, tags: { leisure: 'stadium', name: 'Johnny Unitas Stadium' } },
    { type: 'node', id: 6, lat: 39.39, lon: -76.61, tags: { amenity: 'cafe', name: 'Campus Cafe' } },
  ] });
  assert.deepEqual(data.pois.map((p) => p.name), ['Johnny Unitas Stadium', 'Campus Cafe']);
});
