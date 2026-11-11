// Current weather for Campus Pulse, from Open-Meteo (free, no API key, for
// non-commercial use: https://open-meteo.com/en/terms). Cached on the device
// for 20 minutes so the app stays far below the free limits.

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'tigerpath.weather';
const TTL = 20 * 60 * 1000;

// WMO weather codes → label + icon
const CODES = [
  [[0], 'Clear', '☀️', '🌙'], [[1], 'Mostly clear', '🌤️', '🌙'], [[2], 'Partly cloudy', '⛅', '☁️'], [[3], 'Cloudy', '☁️', '☁️'],
  [[45, 48], 'Fog', '🌫️', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️', '🌧️'], [[61, 63, 65, 80, 81, 82], 'Rain', '🌧️', '🌧️'],
  [[66, 67], 'Freezing rain', '🧊', '🧊'], [[71, 73, 75, 77, 85, 86], 'Snow', '🌨️', '🌨️'], [[95, 96, 99], 'Thunderstorms', '⛈️', '⛈️'],
];
export function describeCode(code, isDay = true) {
  const hit = CODES.find(([codes]) => codes.includes(code)) ?? [[], 'Weather', '🌡️', '🌡️'];
  return { label: hit[1], icon: isDay ? hit[2] : hit[3] };
}

/** w: { tempF, code, precip (mm), windMph } → advice for walking across campus. */
export function weatherAdvice(w) {
  const { label } = describeCode(w.code);
  const snowy = ['Snow', 'Freezing rain'].includes(label);
  const icy = snowy || (w.tempF <= 34 && (w.precip > 0 || ['Drizzle', 'Rain', 'Fog'].includes(label)));
  const wet = icy || ['Drizzle', 'Rain', 'Thunderstorms'].includes(label) || w.precip > 0.2;
  let tip = null;
  if (label === 'Thunderstorms') tip = 'Thunderstorms — wait indoors if you can; the Union and Cook Library are good spots.';
  else if (icy) tip = 'Slippery out — step-free routes skip outdoor stairs.';
  else if (wet) tip = 'Wet out — bring an umbrella and watch for slick stairs.';
  else if (w.tempF >= 90) tip = 'Hot out — bring water; refill stations are in most buildings.';
  else if (w.tempF <= 20) tip = 'Bitter cold — bundle up; shorter routes help.';
  else if (w.windMph >= 25) tip = 'Very windy — hold onto your papers.';
  return { icy, wet, tip };
}

export async function getWeather({ lat = 39.3925, lng = -76.611, fetchFn = globalThis.fetch, storage = globalThis.localStorage, now = Date.now() } = {}) {
  try {
    const c = JSON.parse(storage?.getItem(CACHE_KEY) ?? 'null');
    if (c && now - c.at < TTL) return c.data;
  } catch { /* ignore */ }
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, current: 'temperature_2m,precipitation,weather_code,wind_speed_10m,is_day',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/New_York',
  });
  const res = await fetchFn(`${URL_BASE}?${q}`);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = await res.json();
  const cur = j.current;
  const data = { tempF: Math.round(cur.temperature_2m), code: cur.weather_code, precip: cur.precipitation ?? 0,
    windMph: Math.round(cur.wind_speed_10m ?? 0), isDay: cur.is_day === 1, time: cur.time };
  try { storage?.setItem(CACHE_KEY, JSON.stringify({ at: now, data })); } catch { /* ignore */ }
  return data;
}

export const formatTemp = (f, units = 'imperial') => (units === 'metric' ? `${Math.round(((f - 32) * 5) / 9)}°C` : `${f}°F`);
