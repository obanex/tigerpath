// Several ways to get somewhere: fastest, a genuinely different alternative,
// step-free and best-lit — deduplicated, labelled, and with the quickest marked.
//
// computeRoute(profile, extraCtx) -> { res: { path, edges, dist }, minutes, ... } | null
// (the caller handles endpoints, so step-free routes can end at accessible entrances)

const edgeKeys = (r) => r.res.path.slice(1).map((id, i) => `${r.res.path[i]}|${id}`);

/** Share of route b's length that also lies on route a (0–1). */
export function overlap(a, b) {
  const keys = new Set(edgeKeys(a).flatMap((k) => [k, k.split('|').reverse().join('|')]));
  let shared = 0;
  edgeKeys(b).forEach((k, i) => { if (keys.has(k)) shared += b.res.edges[i].dist; });
  return b.res.dist ? shared / b.res.dist : 1;
}

/** The named path or street that carries most of this route but not the other route. */
export function viaName(r, other) {
  const otherKeys = other ? new Set(edgeKeys(other).flatMap((k) => [k, k.split('|').reverse().join('|')])) : new Set();
  const len = new Map();
  edgeKeys(r).forEach((k, i) => {
    const e = r.res.edges[i];
    if (e.name && !otherKeys.has(k)) len.set(e.name, (len.get(e.name) ?? 0) + e.dist);
  });
  return [...len].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function describe(r) {
  const stairs = r.res.edges.filter((e) => e.stairs).length;
  const litLen = r.res.edges.filter((e) => e.lit === true).reduce((s, e) => s + e.dist, 0);
  return { stairs, litShare: r.res.dist ? litLen / r.res.dist : 0 };
}

// Two options are the same only if they also start and end at the same spot
// (a step-free route may end at a building's accessible entrance instead).
function sameEnds(a, b) {
  if (!a.latlngs || !b.latlngs) return true;
  const near = (p, q) => Math.abs(p[0] - q[0]) < 0.0001 && Math.abs(p[1] - q[1]) < 0.00013; // ≈ 10 m
  return near(a.latlngs[0], b.latlngs[0]) && near(a.latlngs.at(-1), b.latlngs.at(-1));
}

export const KINDS = {
  fastest: { label: 'Fastest', icon: '🚶' },
  alternate: { label: 'Another way', icon: '🔀' },
  stepfree: { label: 'Step-free', icon: '♿' },
  lit: { label: 'Best lit', icon: '🌙' },
};

/**
 * Returns up to four options: [{ kind, label, icon, r, minutes, stairs, litShare, via, badges }].
 * Options that are (nearly) the same path are merged, keeping both badges.
 */
export function routeOptions(computeRoute, { alwaysStepFree = false } = {}) {
  const fastest = computeRoute('standard');
  if (!fastest?.res) return [];
  const cands = [{ kind: 'fastest', r: fastest }];

  // A genuinely different way: penalise the fastest route's segments and search again.
  const avoid = new Set(edgeKeys(fastest).flatMap((k) => [k, k.split('|').reverse().join('|')]));
  const alt = computeRoute('standard', { avoid, avoidFactor: 1.8 });
  if (alt?.res && overlap(fastest, alt) < 0.7 && alt.res.dist <= fastest.res.dist * 1.45) cands.push({ kind: 'alternate', r: alt });

  // Step-free only matters if the fastest way has stairs, raised curbs or a no-wheelchair path.
  const barrier = (r) => r.res.edges.some((e) => e.stairs || e.kerb === 'raised' || e.wheelchair === 'no');
  // …or when it matters anyway: the destination has a listed accessible entrance, or the student prefers step-free.
  if (barrier(fastest) || alwaysStepFree) {
    const stepfree = computeRoute('accessible');
    if (stepfree?.res) cands.push({ kind: 'stepfree', r: stepfree });
  }
  // Best lit only if it's clearly better lit than the fastest way.
  const lit = computeRoute('night');
  if (lit?.res && describe(lit).litShare >= describe(fastest).litShare + 0.15) cands.push({ kind: 'lit', r: lit });

  const out = [];
  for (const c of cands) {
    const same = out.find((o) => overlap(o.r, c.r) > 0.85 && overlap(c.r, o.r) > 0.85 && sameEnds(o.r, c.r));
    if (same) { same.also.push(c.kind); continue; }
    out.push({ ...c, also: [] });
  }
  const quickest = Math.min(...out.map((o) => o.r.minutes));
  return out.map((o) => {
    const d = describe(o.r);
    const badges = [];
    if (o.r.minutes === quickest) badges.push('Quickest');
    if (!d.stairs) badges.push('No stairs');
    if ((o.kind === 'lit' || o.also.includes('lit')) && d.litShare > 0) badges.push(`${Math.round(d.litShare * 100)}% lit`);
    return { ...o, ...KINDS[o.kind], minutes: o.r.minutes, stairs: d.stairs, litShare: d.litShare,
      via: o.kind === 'fastest' ? null : viaName(o.r, fastest), badges };
  });
}
