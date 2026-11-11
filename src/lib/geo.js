const R = 6371008.8; // mean earth radius, meters
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b in degrees, 0 = north, clockwise. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest turn from bearing b1 to b2, in (-180, 180]. Positive = right. */
export function turnAngle(b1, b2) {
  let d = (b2 - b1 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compass = (b) => COMPASS[Math.round(b / 45) % 8];

/** Local planar projection (meters) around a reference latitude — accurate at campus scale. */
export function projector(refLat) {
  const kx = (Math.PI / 180) * R * Math.cos(rad(refLat));
  const ky = (Math.PI / 180) * R;
  return (p) => ({ x: p.lng * kx, y: p.lat * ky });
}

export function centroid(points) {
  let lat = 0, lng = 0;
  for (const p of points) { lat += p.lat; lng += p.lng; }
  return { lat: lat / points.length, lng: lng / points.length };
}

export function formatDistance(m, units = 'imperial') {
  if (units === 'metric') return m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`;
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.round(ft / 10) * 10} ft` : `${(m / 1609.344).toFixed(2)} mi`;
}

export function formatMinutes(min) {
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}
