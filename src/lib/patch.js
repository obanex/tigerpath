/** Rewrite lat/lng in the buildings.js source text for each moved building. */
export function patchSource(src, moves) {
  let out = src;
  for (const [id, { lat, lng }] of Object.entries(moves)) {
    const at = out.indexOf(`id: '${id}'`);
    if (at < 0) continue;
    const re = /lat: -?[\d.]+, lng: -?[\d.]+/y;
    const rel = out.slice(at).search(/lat: -?[\d.]+, lng: -?[\d.]+/);
    if (rel < 0) continue;
    re.lastIndex = at + rel;
    out = out.replace(re, `lat: ${lat}, lng: ${lng}`);
  }
  return out;
}

