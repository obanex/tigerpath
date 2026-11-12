import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph, route } from '../src/lib/graph.js';
import { tagGraph, addTuRoutes, mergeBuildings, activeConstruction } from '../src/lib/tu.js';
import { createIndex, search } from '../src/lib/search.js';

// A straight east–west walkway with three nodes ~30 m apart.
function walkway() {
  const g = new Graph();
  g.addNode('a', 39.39, -76.61); g.addNode('b', 39.39, -76.60965); g.addNode('c', 39.39, -76.6093);
  g.addEdge('a', 'b', { path: true }); g.addEdge('b', 'c', { path: true });
  return g;
}
const edge = (g, x, y) => g.adj.get(x).find((e) => e.to === y);

test('tagGraph: a parallel TU route rates the walkway; a crossing one does not', () => {
  const g = walkway();
  const tu = { stairs: [], accessRoutes: [
    { rating: 'no', line: [[39.39001, -76.61], [39.39001, -76.60965]] },       // along a–b
    { rating: 'yes', line: [[39.3897, -76.60947], [39.3903, -76.60947]] },     // crosses b–c at right angles
  ] };
  const n = tagGraph(g, tu);
  assert.equal(n.rated, 1);
  assert.equal(edge(g, 'a', 'b').wheelchair, 'no');
  assert.equal(edge(g, 'b', 'a').wheelchair, 'no'); // both directions
  assert.equal(edge(g, 'b', 'c').wheelchair, undefined);
  assert.equal(route(g, 'a', 'c', 'accessible'), null); // TU says not accessible
  assert.ok(route(g, 'a', 'c', 'standard'));
});

test('tagGraph: TU stairs next to a walkway mark it as stairs, unless TU rates it accessible', () => {
  const g = walkway();
  tagGraph(g, { accessRoutes: [{ rating: 'yes', line: [[39.39, -76.60965], [39.39, -76.6093]]}], stairs: [[39.39001, -76.60982], [39.39001, -76.60947]] });
  assert.equal(edge(g, 'a', 'b').stairs, true);
  assert.equal(edge(g, 'b', 'c').stairs, undefined);
});

test('addTuRoutes: step-free connectors only serve step-free routes', () => {
  const g = new Graph();
  // two walkway pieces with a flight of stairs between them, and TU's ramp alongside
  g.addNode('a', 39.39, -76.61); g.addNode('b', 39.39, -76.6099); g.addNode('c', 39.39, -76.6095); g.addNode('d', 39.39, -76.6094);
  g.addEdge('a', 'b', { path: true }); g.addEdge('b', 'c', { path: true, stairs: true }); g.addEdge('c', 'd', { path: true });
  assert.equal(route(g, 'a', 'd', 'accessible'), null);
  const added = addTuRoutes(g, { accessRoutes: [{ rating: 'yes', line: [[39.39003, -76.6099], [39.3902, -76.6097], [39.39003, -76.6095]] }] });
  assert.equal(added, 2);
  const step = route(g, 'a', 'd', 'accessible');
  assert.ok(step, 'TU ramp joins the pieces');
  assert.ok(step.path.some((id) => String(id).startsWith('tu:')));
  const std = route(g, 'a', 'd', 'standard');
  assert.ok(std.path.every((id) => !String(id).startsWith('tu:')), 'regular routes keep to the walkways');
});

test('mergeBuildings: codes, offices without duplicates, entrances, extra buildings', () => {
  const buildings = [{ id: 'ST', name: 'Stephens Hall', depts: ['English', 'Theatre'], amenities: [] }];
  const extras = mergeBuildings(buildings, {
    buildings: { ST: { code: 'SA', restrooms: 'Room 101' } },
    extraBuildings: [{ id: 'tu-PS', code: 'PS', name: 'Public Safety', category: 'services', lat: 39.39, lng: -76.6 }],
    departments: [
      { name: 'Department of English', building: 'ST', link: 'https://x', aliases: ['English Dept'] },
      { name: 'TU Police', building: 'tu-PS', aliases: ['Police'] },
    ],
    entrances: [{ building: 'ST', lat: 39.39, lng: -76.6 }],
  });
  const st = buildings[0];
  assert.deepEqual(st.depts, ['Theatre', 'Department of English']);
  assert.ok(st.aliases.includes('SA') && st.aliases.includes('English Dept'));
  assert.ok(st.amenities.includes('accessible-entrance') && st.amenities.includes('restroom'));
  assert.equal(extras.length, 1);
  assert.equal(extras[0].tag, 'PS');
  assert.deepEqual(extras[0].depts, ['TU Police']);
});

test('search: a room on TU’s official code wins over a TigerPath id', () => {
  const idx = createIndex([
    { id: 'AR', name: 'SECU Arena', tu: { code: 'TA' } },
    { id: 'tu-AR', tag: 'AR', name: 'The Armory', tu: { code: 'AR' } },
    { id: 'ST', name: 'Stephens Hall', tu: { code: 'SA' } },
  ]);
  assert.equal(search(idx, 'AR 101')[0].item.name, 'The Armory');
  assert.equal(search(idx, 'SA 102')[0].item.name, 'Stephens Hall');
  assert.equal(search(idx, 'ST 102')[0].item.name, 'Stephens Hall'); // TigerPath's own code still works
});

test('activeConstruction: dated areas expire', () => {
  const tu = { construction: [{ name: 'A', until: '2026-12-31' }, { name: 'B', until: '2025-12-31' }, { name: 'C', until: null }] };
  assert.deepEqual(activeConstruction(tu, '2026-11-12').map((c) => c.name), ['A', 'C']);
});
