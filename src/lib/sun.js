// Sunrise / sunset (NOAA's simplified solar equations, accurate to a few minutes)
// — used to switch to well-lit routes automatically after dark.

const rad = Math.PI / 180;

export function sunTimes(date, lat, lng) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const base = Date.UTC(y, m, d);
  const dayOfYear = Math.round((base - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosHa))) / rad;
  return {
    sunrise: new Date(base + (720 - 4 * (lng + ha) - eqtime) * 60000),
    sunset: new Date(base + (720 - 4 * (lng - ha) - eqtime) * 60000),
  };
}

export function isDarkOutside(now = new Date(), lat = 39.3925, lng = -76.611) {
  const { sunrise, sunset } = sunTimes(now, lat, lng);
  return now < sunrise || now > sunset;
}
