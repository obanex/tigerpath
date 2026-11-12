import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNav, update, splitRoute, turnIcon, spokenDistance } from '../src/lib/nav.js';

// An L-shaped route: 100 m north, then 100 m east (a right turn at the corner).
const N = 0.0009; // ≈100 m of latitude
const E = 0.00116; // ≈100 m of longitude at 39.39°
const A = [39.39, -76.61], B = [39.39 + N, -76.61], C = [39.39 + N, -76.61 + E];
const route = {
  latlngs: [A, [39.39 + N / 2, -76.61], B, [39.39 + N, -76.61 + E / 2], C],
  steps: [
    { text: 'Head north on Cross Campus Drive', type: 'depart', idx: 0, dist: 100 },
    { text: 'Turn right on Towson Way, passing Linthicum Hall', type: 'turn', idx: 2, dist: 100 },
    { text: 'Arrive at Liberal Arts Building', type: 'arrive', idx: 4, dist: 0 },
  ],
};
const at = (lat, lng, acc = 5) => ({ lat, lng, acc });

test('walking the route: next turn, distance to it, spoken prompts, arrival', () => {
  const nav = createNav(route);
  assert.ok(Math.abs(nav.total - 200) < 3, `route length ${nav.total}`);

  let u = update(nav, at(...A));
  assert.equal(u.say, 'Head north on Cross Campus Drive');
  assert.equal(turnIcon(u.next), 'right');
  assert.ok(Math.abs(u.toNext - 100) < 3);
  assert.ok(Math.abs(u.remaining - 200) < 3);

  u = update(nav, at(39.39 + N * 0.5, -76.61));
  assert.equal(u.say, null); // nothing to say mid-block
  assert.ok(Math.abs(u.toNext - 50) < 3);

  u = update(nav, at(39.39 + N * 0.7, -76.61)); // 30 m before the corner
  assert.match(u.say, /^In 100 feet, turn right on Towson Way$/);
  u = update(nav, at(39.39 + N * 0.72, -76.61));
  assert.equal(u.say, null, 'each prompt is spoken once');

  u = update(nav, at(39.39 + N * 0.93, -76.61)); // at the corner
  assert.equal(u.say, 'Turn right on Towson Way');

  u = update(nav, at(39.39 + N, -76.61 + E * 0.3));
  assert.equal(u.next.type, 'arrive');
  assert.ok(Math.abs(u.remaining - 70) < 4);

  u = update(nav, at(39.39 + N, -76.61 + E * 0.95));
  assert.equal(u.arrived, true);
  assert.equal(u.say, 'You have arrived');
});

test('GPS noise near the path snaps onto it; leaving the route triggers a reroute after two fixes', () => {
  const nav = createNav(route);
  let u = update(nav, at(39.39 + N * 0.4, -76.61 + 0.00006)); // ~5 m east of the path
  assert.ok(u.offBy < 8);
  assert.equal(u.snapped.lng, -76.61, 'drawn on the path');
  assert.equal(u.offRoute, false);

  const wrong = at(39.39 + N * 0.4, -76.61 - 0.0006); // ~50 m west, off the route
  assert.equal(update(nav, wrong).offRoute, false, 'one bad fix could be GPS noise');
  assert.equal(update(nav, wrong).offRoute, true);
});

test('progress does not jump backwards on a stray fix', () => {
  const nav = createNav(route);
  update(nav, at(39.39 + N, -76.61 + E * 0.5)); // already on the second leg
  const u = update(nav, at(39.39 + N * 0.2, -76.61)); // one fix far back along the route
  assert.ok(u.along > 140, `along ${u.along}`);
});

test('splitRoute draws the walked part and the part ahead from the walker', () => {
  const nav = createNav(route);
  const u = update(nav, at(39.39 + N, -76.61 + E * 0.25));
  const { done, ahead } = splitRoute(nav, u.snapped);
  assert.deepEqual(done.at(-1), ahead[0]);
  assert.deepEqual(ahead.at(-1), C);
});

test('spoken distances round the way people say them', () => {
  assert.equal(spokenDistance(30), '100 feet');
  assert.equal(spokenDistance(12), '50 feet');
  assert.equal(spokenDistance(400), 'a quarter mile');
  assert.equal(spokenDistance(45, 'metric'), '50 meters');
});
