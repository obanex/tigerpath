// Apply Towson University's own campus map data (public/data/tu-campus.json,
// made by scripts/fetch-tu.mjs from the layers behind maps.towson.edu) to
// TigerPath's walking network and buildings.

import { projector } from './geo.js';

const RATING_RANK = { no: 0, limited: 1, yes: 2 };

/** Distance (m) from point p to segment ab, all in projected meters. */
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Angle (0–90°) between two undirected segments. */
function segAngle(a, b, c, d) {
  const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(d.y - c.y, d.x - c.x);
  let x = Math.abs(t1 - t2) % Math.PI;
  if (x > Math.PI / 2) x = Math.PI - x;
  return (x * 180) / Math.PI;
}

/**
 * Tag walkway edges with TU's accessibility survey:
 *  - an edge running along a TU-rated route segment gets edge.wheelchair =
 *    'yes' | 'limited' | 'no' (TU's "Accessible" / "Limited" / "Not Accessible");
 *  - an edge passing within `stairsTol` m of a TU stairs point becomes stairs,
 *    unless TU rates that stretch accessible.
 * An OpenStreetMap 'no' is never upgraded. Returns counts of tagged edges.
 */
export function tagGraph(graph, tu, { routeTol = 4, stairsTol = 3, maxAngle = 30 } = {}) {
  if (!tu) return { rated: 0, stairs: 0 };
  const P = projector(39.39);
  const cell = 25;
  const grid = new Map();
  const put = (key, v) => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(v); };
  const keysAround = (p, r) => {
    const out = [];
    for (let i = Math.floor((p.x - r) / cell); i <= Math.floor((p.x + r) / cell); i++)
      for (let j = Math.floor((p.y - r) / cell); j <= Math.floor((p.y + r) / cell); j++) out.push(`${i},${j}`);
    return out;
  };
  for (const r of tu.accessRoutes ?? []) {
    const pts = r.line.map(([lat, lng]) => P({ lat, lng }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
      for (const k of keysAround(mid, half)) put(k, { a, b, rating: r.rating });
    }
  }
  const stairGrid = new Map();
  for (const [lat, lng] of tu.stairs ?? []) {
    const p = P({ lat, lng });
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!stairGrid.has(k)) stairGrid.set(k, []);
    stairGrid.get(k).push(p);
  }

  let rated = 0, stairs = 0;
  const done = new Set();
  for (const [from, list] of graph.adj) for (const e of list) {
    if (!e.path) continue; // only real walkways, not the links to building centers
    const key = from < e.to ? `${from}|${e.to}` : `${e.to}|${from}`;
    if (done.has(key)) continue;
    done.add(key);
    const A = P(graph.nodes.get(from)), B = P(graph.nodes.get(e.to));
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const len = Math.hypot(B.x - A.x, B.y - A.y);

    // best-matching TU route segment: close to the edge's midpoint and roughly parallel
    let best = null;
    for (const k of keysAround(mid, routeTol)) for (const s of grid.get(k) ?? []) {
      if (segDist(mid, s.a, s.b) > routeTol) continue;
      if (len > 2 && segAngle(A, B, s.a, s.b) > maxAngle) continue;
      if (!best || RATING_RANK[s.rating] < RATING_RANK[best]) best = s.rating; // the worst rating wins
    }
    const flags = {};
    if (best && e.wheelchair !== 'no') { flags.wheelchair = best; flags.tuRated = true; rated++; }

    if (!e.stairs && best !== 'yes') {
      const near = keysAround(mid, len / 2 + stairsTol).some((k) => (stairGrid.get(k) ?? []).some((p) => segDist(p, A, B) <= stairsTol));
      if (near) { flags.stairs = true; flags.tuStairs = true; stairs++; }
    }
    if (Object.keys(flags).length) graph.setEdgeFlags(from, e.to, flags);
  }
  return { rated, stairs };
}

/**
 * Add TU's surveyed accessible / limited-accessibility routes to the graph as
 * walkway edges, stitched to nearby walkway nodes. OpenStreetMap lacks some of
 * these paths (e.g. the ramp to a library's accessible door); every route type
 * can use them, so the fastest route is never longer than the step-free one.
 */
export function addTuRoutes(graph, tu, { stitch = 6, stitchEnd = 15 } = {}) {
  if (!tu?.accessRoutes?.length) return 0;
  const P = projector(39.39);
  const cell = 20;
  const grid = new Map();
  for (const n of graph.nodes.values()) {
    const p = P(n);
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ id: n.id, p });
  }
  const nearby = (p, r) => {
    const out = [];
    for (let i = Math.floor((p.x - r) / cell); i <= Math.floor((p.x + r) / cell); i++)
      for (let j = Math.floor((p.y - r) / cell); j <= Math.floor((p.y + r) / cell); j++)
        for (const n of grid.get(`${i},${j}`) ?? []) { const d = Math.hypot(n.p.x - p.x, n.p.y - p.y); if (d <= r) out.push({ ...n, d }); }
    return out.sort((a, b) => a.d - b.d);
  };
  const keyOf = (lat, lng) => `tu:${lat},${lng}`; // shared vertices join TU lines to each other
  let added = 0;
  for (const r of tu.accessRoutes) {
    if (r.rating === 'no') continue;
    const flags = { path: true, wheelchair: r.rating, tuPath: true, tuRated: true };
    let prev = null;
    r.line.forEach(([lat, lng], i) => {
      const id = keyOf(lat, lng);
      const end = i === 0 || i === r.line.length - 1; // loose ends were meant to join something: reach further
      if (!graph.nodes.has(id) || end) {
        graph.addNode(id, lat, lng);
        const p = P({ lat, lng });
        for (const n of nearby(p, end ? stitchEnd : stitch).filter((n) => n.id !== id && !String(n.id).startsWith('tu:')).slice(0, 2)) graph.addEdge(id, n.id, { ...flags, stitch: true });
      }
      if (prev && prev !== id) { graph.addEdge(prev, id, flags); added++; }
      prev = id;
    });
  }
  return added;
}

/** Merge TU's building info and department index into TigerPath's buildings (mutates them). Returns extra buildings to add. */
export function mergeBuildings(buildings, tu) {
  if (!tu) return [];
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const lower = (list) => new Set(list.map((x) => x.toLowerCase()));
  for (const [id, info] of Object.entries(tu.buildings ?? {})) {
    const b = byId.get(id);
    if (!b) continue;
    b.tu = info;
    if (info.code && info.code !== id) b.aliases = [...(b.aliases ?? []), info.code];
    if (info.restrooms && !b.amenities?.includes('restroom')) b.amenities = [...(b.amenities ?? []), 'restroom'];
  }
  const extras = (tu.extraBuildings ?? []).map((x) => ({
    id: x.id, tag: x.code ?? x.id, name: x.name, category: x.category, lat: x.lat, lng: x.lng,
    aliases: x.code ? [x.code] : [], depts: [], amenities: x.restrooms ? ['restroom'] : [], extra: true, tu: x,
  }));
  for (const x of extras) byId.set(x.id, x);
  for (const d of tu.departments ?? []) {
    const b = byId.get(d.building);
    if (!b) continue;
    b.offices = [...(b.offices ?? []), d];
    const al = lower([...(b.aliases ?? []), ...(b.depts ?? [])]);
    for (const a of d.aliases) if (!al.has(a.toLowerCase())) b.aliases = [...(b.aliases ?? []), a];
  }
  // Office list: TigerPath's own entries first, minus ones TU names more fully
  // ("English" vs "Department of English"), then TU's.
  for (const b of byId.values()) {
    if (!b.offices?.length) continue;
    const tuNames = [...new Set(b.offices.map((o) => o.name))];
    const tl = tuNames.map((t) => t.toLowerCase());
    const ours = (b.depts ?? []).filter((d) => !tl.some((t) => t.includes(d.toLowerCase())));
    b.depts = [...ours, ...tuNames];
  }
  for (const e of tu.entrances ?? []) {
    const b = byId.get(e.building);
    if (b && !b.amenities?.includes('accessible-entrance')) b.amenities = [...(b.amenities ?? []), 'accessible-entrance'];
  }
  return extras;
}

/** Construction areas that are still active today (until is the last day, inclusive). */
export const activeConstruction = (tu, today = new Date().toISOString().slice(0, 10)) =>
  (tu?.construction ?? []).filter((c) => !c.until || c.until >= today);
