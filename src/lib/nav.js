// Turn-by-turn navigation: where the walker is along the route, the next turn,
// distance to it, what's left, when to speak, and when they've gone off course.
// Pure logic (no map, no DOM), so it can be tested without walking around campus.

import { distance, bearing, projector } from './geo.js';

/**
 * route: { latlngs: [[lat,lng],...], steps: [{ text, type, idx, dist }] } from computeRoute()
 * (step.idx is the index in latlngs where that step starts).
 */
export function createNav(route) {
  const pts = route.latlngs.map(([lat, lng]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distance(pts[i - 1], pts[i]));
  const total = cum.at(-1);
  // maneuvers: every turn plus the arrival, each at a distance along the route
  const maneuvers = route.steps
    .map((s, i) => ({ ...s, n: i, at: s.type === 'arrive' ? total : cum[Math.min(s.idx ?? 0, cum.length - 1)] }))
    .filter((s) => s.type !== 'depart');
  return { pts, cum, total, maneuvers, depart: route.steps[0], seg: 0, along: 0, offCount: 0, spoken: new Set(), arrived: false };
}

/** Closest point on the route to `me`, searching near the last known progress first (routes can double back). */
function project(nav, me) {
  const P = projector(me.lat);
  const p = P(me);
  let best = null;
  const scan = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(nav.pts.length - 1, to); i++) {
      const a = P(nav.pts[i]), b = P(nav.pts[i + 1]);
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (!best || d < best.d - 0.5) best = { d, seg: i, t, along: nav.cum[i] + t * (nav.cum[i + 1] - nav.cum[i]) };
    }
  };
  scan(nav.seg - 2, nav.seg + 40); // nearby, ahead
  if (!best || best.d > 25) scan(0, nav.pts.length); // lost? look everywhere
  if (!best) return { d: Infinity, seg: 0, along: 0, point: nav.pts[0] };
  const a = nav.pts[best.seg], b = nav.pts[best.seg + 1] ?? a;
  return { ...best, point: { lat: a.lat + best.t * (b.lat - a.lat), lng: a.lng + best.t * (b.lng - a.lng) } };
}

/** Kind of arrow to draw for a step. */
export function turnIcon(step) {
  if (!step || step.type === 'arrive') return 'arrive';
  const t = step.text.toLowerCase();
  if (/sharp left/.test(t)) return 'sharp-left';
  if (/sharp right/.test(t)) return 'sharp-right';
  if (/bear left/.test(t)) return 'slight-left';
  if (/bear right/.test(t)) return 'slight-right';
  if (/left/.test(t)) return 'left';
  if (/right/.test(t)) return 'right';
  return 'straight';
}

/** "Turn left on Towson Way, passing Linthicum Hall" → "Turn left on Towson Way" (the banner keeps it short). */
export const shortText = (step) => (step?.text ?? '').replace(/, passing .*$/, '');
/** What the voice says for a step: "Bear right (stairs)" → "Bear right, then take the stairs". */
const spoken = (step) => shortText(step).replace(/ \(stairs\)/, ', then take the stairs');

/**
 * Feed a GPS fix. Returns what the screen (and voice) should show:
 * { snapped, offBy, along, remaining, next, then, toNext, heading, offRoute, arrived, say }
 * - offRoute: true after 2 fixes in a row more than max(25 m, accuracy) from the route → reroute
 * - say: text to speak now, or null (each prompt is spoken once)
 */
export function update(nav, me, { accuracy = me.acc ?? 10, speak = (m) => spokenDistance(m) } = {}) {
  const pr = project(nav, me);
  const tolerance = Math.max(25, Math.min(60, accuracy * 1.5));
  nav.offCount = pr.d > tolerance ? nav.offCount + 1 : 0;
  // progress only moves forward, unless two fixes in a row say the walker really went back
  const back = pr.along < nav.along - 15;
  nav.backCount = back ? (nav.backCount ?? 0) + 1 : 0;
  if (!back || nav.backCount >= 2) { nav.along = pr.along; nav.seg = pr.seg; }
  const remaining = Math.max(0, nav.total - nav.along);
  const end = nav.pts.at(-1);
  const toEnd = distance(me, end);
  const idx = nav.maneuvers.findIndex((m) => m.at > nav.along + 4);
  const next = idx >= 0 ? nav.maneuvers[idx] : nav.maneuvers.at(-1);
  const then = idx >= 0 ? nav.maneuvers[idx + 1] ?? null : null;
  const toNext = Math.max(0, next.at - nav.along);
  // direction of travel on the route here (for the arrow on the walker's dot)
  const a = nav.pts[nav.seg], b = nav.pts[Math.min(nav.seg + 1, nav.pts.length - 1)];
  const heading = a === b ? null : bearing(a, b);

  let say = null;
  if (!nav.spoken.has('start')) { nav.spoken.add('start'); say = spoken(nav.depart); }
  const arrived = !nav.arrived && (toEnd < 20 || (remaining < 15 && pr.d < 30));
  if (arrived) { nav.arrived = true; say = 'You have arrived'; }
  else if (next.type !== 'arrive' && !nav.offCount) {
    const k = next.n;
    if (toNext <= 12 && !nav.spoken.has(`now:${k}`)) { nav.spoken.add(`now:${k}`); nav.spoken.add(`soon:${k}`); say = spoken(next); }
    else if (toNext <= 45 && toNext > 12 && !nav.spoken.has(`soon:${k}`)) { nav.spoken.add(`soon:${k}`); say = `In ${speak(toNext)}, ${lowerFirst(spoken(next))}`; }
  } else if (next.type === 'arrive' && toNext <= 45 && !nav.spoken.has('soon:end')) { nav.spoken.add('soon:end'); say = `Your destination is ${speak(toNext)} ahead`; }

  return { snapped: pr.d < 15 ? pr.point : me, offBy: pr.d, along: nav.along, remaining, next, then, toNext, heading,
    offRoute: nav.offCount >= 2, arrived, say };
}
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** The part of the route still ahead (for drawing: walked part grey, the rest in color). */
export function splitRoute(nav, snapped) {
  const done = nav.pts.slice(0, nav.seg + 1).map((p) => [p.lat, p.lng]);
  const ahead = nav.pts.slice(nav.seg + 1).map((p) => [p.lat, p.lng]);
  const here = [snapped.lat, snapped.lng];
  return { done: [...done, here], ahead: [here, ...ahead] };
}

/** Spoken distance: "150 feet", "a quarter mile" / "50 meters". */
export function spokenDistance(m, units = 'imperial') {
  if (units === 'metric') return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} meters` : `${(m / 1000).toFixed(1)} kilometers`;
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} feet`;
  const mi = m / 1609.344;
  return mi < 0.35 ? 'a quarter mile' : mi < 0.6 ? 'half a mile' : `${mi.toFixed(1)} miles`;
}
