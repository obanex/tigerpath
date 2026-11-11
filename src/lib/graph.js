// Walking network + routing.
//
// Two sources build the same Graph shape:
//   1. buildSeedGraph()  – a Gabriel graph over building entrances (works offline,
//      no external data, approximate).
//   2. graphFromOsm()    – real walkways from OpenStreetMap (src/lib/osm.js).
//
// Edge flags let one graph serve several routing profiles (standard,
// accessible, night) without rebuilding.

import { distance, bearing, turnAngle, compass, projector } from './geo.js';

export class Graph {
  constructor() {
    this.nodes = new Map(); // id -> { id, lat, lng, label? }
    this.adj = new Map();   // id -> Edge[]
  }
  addNode(id, lat, lng, label) {
    if (!this.nodes.has(id)) { this.nodes.set(id, { id, lat, lng, label }); this.adj.set(id, []); }
    return this.nodes.get(id);
  }
  /** flags: { stairs, lit (true/false/undefined), wheelchair ('no'), steep, name, closed } */
  addEdge(a, b, flags = {}) {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b)) return;
    if (this.adj.get(a).some((e) => e.to === b)) return;
    const dist = distance(this.nodes.get(a), this.nodes.get(b));
    this.adj.get(a).push({ to: b, dist, ...flags });
    this.adj.get(b).push({ to: a, dist, ...flags });
  }
  removeEdge(a, b) {
    if (this.adj.has(a)) this.adj.set(a, this.adj.get(a).filter((e) => e.to !== b));
    if (this.adj.has(b)) this.adj.set(b, this.adj.get(b).filter((e) => e.to !== a));
  }
  setEdgeFlags(a, b, flags) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const e = this.adj.get(x)?.find((e) => e.to === y);
      if (e) Object.assign(e, flags);
    }
  }
  edges() {
    const out = [];
    for (const [a, list] of this.adj) for (const e of list) if (a < e.to) out.push({ from: a, ...e });
    return out;
  }
  /** Node ids of the largest connected piece of the network. */
  mainComponent() {
    const seen = new Set();
    let best = new Set();
    for (const id of this.nodes.keys()) {
      if (seen.has(id)) continue;
      const comp = new Set([id]); const stack = [id]; seen.add(id);
      while (stack.length) for (const e of this.adj.get(stack.pop())) if (!seen.has(e.to)) { seen.add(e.to); comp.add(e.to); stack.push(e.to); }
      if (comp.size > best.size) best = comp;
    }
    return best;
  }
  /** k nearest node ids to a point, optionally filtered. */
  nearest(p, k = 1, filter = () => true) {
    return [...this.nodes.values()].filter(filter)
      .map((n) => ({ id: n.id, d: distance(p, n) }))
      .sort((x, y) => x.d - y.d).slice(0, k);
  }
}

/**
 * Gabriel graph: connect i–j when no other point lies inside the circle whose
 * diameter is i–j. Gives a planar, sensible "walkway-like" mesh between
 * buildings without crossing through neighbours.
 */
export function buildSeedGraph(points, { maxEdge = 320, overrides = {} } = {}) {
  const g = new Graph();
  const proj = projector(points[0]?.lat ?? 39.39);
  const P = points.map((p) => ({ ...p, ...proj(p) }));
  for (const p of P) g.addNode(p.id, p.lat, p.lng, p.label);
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const r2 = ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) / 4;
      if (r2 > (maxEdge / 2) ** 2) continue;
      let empty = true;
      for (let k = 0; k < P.length && empty; k++) {
        if (k === i || k === j) continue;
        if ((P[k].x - cx) ** 2 + (P[k].y - cy) ** 2 < r2) empty = false;
      }
      if (empty) g.addEdge(a.id, b.id);
    }
  }
  connectComponents(g);
  for (const [a, b] of overrides.remove ?? []) g.removeEdge(a, b);
  for (const [a, b, flags] of overrides.add ?? []) g.addEdge(a, b, flags);
  for (const [a, b, flags] of overrides.flags ?? []) g.setEdgeFlags(a, b, flags);
  return g;
}

/** Join disconnected clusters (e.g. far-off athletics fields) via their closest pair of nodes. */
function connectComponents(g) {
  for (;;) {
    const comp = new Map();
    let n = 0;
    for (const id of g.nodes.keys()) {
      if (comp.has(id)) continue;
      const stack = [id]; comp.set(id, n);
      while (stack.length) for (const e of g.adj.get(stack.pop())) if (!comp.has(e.to)) { comp.set(e.to, n); stack.push(e.to); }
      n++;
    }
    if (n <= 1) return;
    let best = null; // closest pair between component 0 and any other component
    for (const [a, ca] of comp) {
      if (ca !== 0) continue;
      for (const [b, cb] of comp) {
        if (cb === 0) continue;
        const d = distance(g.nodes.get(a), g.nodes.get(b));
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    g.addEdge(best.a, best.b);
  }
}

// ---------- Routing profiles ----------

export const PROFILES = {
  standard:   { label: 'Fastest',    speed: 1.34 }, // m/s ≈ 3 mph
  accessible: { label: 'Accessible', speed: 1.0 },  // avoids stairs & wheelchair=no
  night:      { label: 'Well-lit',   speed: 1.34 }, // prefers lit paths, near emergency phones
};

/** Returns a cost multiplier for an edge, or Infinity if unusable. */
export function edgeCost(edge, profile, ctx = {}) {
  if (edge.closed) return Infinity;
  let f = 1;
  if (profile === 'accessible') {
    if (edge.stairs || edge.wheelchair === 'no') return Infinity;
    if (edge.steep) f *= 2.5;
  } else if (edge.stairs) {
    f *= 1.15; // stairs are a bit slower even for walkers
  }
  if (profile === 'night') {
    if (edge.lit === false) f *= 2.0;
    else if (edge.lit === undefined) f *= 1.25;
    if (ctx.phones && !edge.nearPhone) f *= 1.2; // nearPhone is precomputed when phone data exists
  }
  return f;
}

/** A* shortest path. Returns { path: nodeId[], dist, edges } or null. */
export function route(g, from, to, profile = 'standard', ctx = {}) {
  if (!g.nodes.has(from) || !g.nodes.has(to)) return null;
  const goal = g.nodes.get(to);
  const h = (id) => distance(g.nodes.get(id), goal);
  const gScore = new Map([[from, 0]]);
  const came = new Map();
  const open = new MinHeap();
  open.push(from, h(from));
  const closed = new Set();
  while (open.size) {
    const cur = open.pop();
    if (cur === to) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    for (const e of g.adj.get(cur)) {
      const c = edgeCost(e, profile, ctx);
      if (c === Infinity) continue;
      const tentative = gScore.get(cur) + e.dist * c;
      if (tentative < (gScore.get(e.to) ?? Infinity)) {
        gScore.set(e.to, tentative);
        came.set(e.to, { prev: cur, edge: e });
        open.push(e.to, tentative + h(e.to));
      }
    }
  }
  if (!gScore.has(to)) return null;
  const path = [to], edges = [];
  let dist = 0;
  for (let n = to; n !== from;) {
    const { prev, edge } = came.get(n);
    edges.unshift(edge); dist += edge.dist; path.unshift(prev); n = prev;
  }
  return { path, edges, dist };
}

/**
 * Turn a node path into human directions. Consecutive segments with a small
 * bearing change (and the same street name) are merged.
 */
export function directions(g, result, { fromLabel, toLabel } = {}) {
  const { path, edges } = result;
  const pts = path.map((id) => g.nodes.get(id));
  if (pts.length < 2) return [{ text: `You're already at ${toLabel ?? 'your destination'}.`, dist: 0, type: 'arrive' }];
  // 1. one raw segment per edge
  let segs = edges.map((e, i) => ({ from: i, to: i + 1, dist: e.dist, name: e.name, stairs: !!e.stairs, passes: [] }));
  const segBearing = (s) => bearing(pts[s.from], pts[s.to]);
  // 2. absorb tiny segments (real path data is full of 2–10 m kinks) into the previous one
  const MIN = 15; // meters
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && (s.dist < MIN || last.dist < MIN) && (!s.name || !last.name || s.name === last.name)) {
      last.to = s.to; last.dist += s.dist; last.stairs ||= s.stairs; last.name ||= s.name;
      if (pts[s.from].label) last.passes.push(pts[s.from].label);
    } else merged.push({ ...s });
  }
  // 3. merge straight-ish continuations on the same path
  segs = [];
  for (const s of merged) {
    const last = segs[segs.length - 1];
    const limit = s.name && s.name === last?.name ? 70 : 35; // named roads curve; follow them
    if (last && Math.abs(turnAngle(segBearing(last), segBearing(s))) < limit && (last.name ?? '') === (s.name ?? '') && last.stairs === s.stairs) {
      last.to = s.to; last.dist += s.dist;
      if (pts[s.from].label) last.passes.push(pts[s.from].label);
    } else segs.push(s);
  }
  for (const s of segs) { s.startBearing = segBearing(s); s.endBearing = s.startBearing; }
  const steps = [];
  segs.forEach((s, i) => {
    const along = s.name ? ` on ${s.name}` : '';
    const via = s.stairs ? ' (stairs)' : '';
    let text;
    if (i === 0) {
      text = `Head ${compass(s.startBearing)}${along}${fromLabel ? ` from ${fromLabel}` : ''}${via}`;
    } else {
      const t = turnAngle(segs[i - 1].endBearing, s.startBearing);
      const a = Math.abs(t);
      const dir = t > 0 ? 'right' : 'left';
      const verb = a < 50 ? `Bear ${dir}` : a < 135 ? `Turn ${dir}` : `Make a sharp ${dir}`;
      text = `${verb}${along}${via}`;
    }
    const passes = s.passes.filter(Boolean);
    if (passes.length) text += `, passing ${passes.slice(0, 2).join(' and ')}`;
    steps.push({ text, dist: s.dist, type: i === 0 ? 'depart' : 'turn', at: pts[s.from] });
  });
  steps.push({ text: `Arrive at ${toLabel ?? 'destination'}`, dist: 0, type: 'arrive', at: pts[pts.length - 1] });
  return steps;
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) {
    const a = this.a; a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0][1], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
