import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import { BUILDINGS, CATEGORIES, AMENITY_LABELS } from './data/buildings.js';
import { PARKING, PERMIT_LABELS, SHUTTLES, LIVE_SHUTTLE_URL, SAFETY, CLOSURES } from './data/places.js';
import { buildSeedGraph, route, directions, PROFILES } from './lib/graph.js';
import { graphFromProcessed, matchBuildings } from './lib/osm.js';
import { createIndex, search } from './lib/search.js';
import { openStatus, weekTable, DAYS, DAY_LABELS, formatTime } from './lib/hours.js';
import { planDay, toICS, WEEKDAYS } from './lib/schedule.js';
import { distance, formatDistance, formatMinutes } from './lib/geo.js';
import { dayKey } from './lib/activity.js';
import { initEditor, applyPinOverrides } from './ui/editor.js';
import { AccountService, LocalBackend, SupabaseBackend } from './lib/account.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createTracker } from './ui/tracker.js';
import { createReminders } from './ui/notify.js';
import { createMeView } from './ui/me.js';
import { routeOptions } from './lib/alternatives.js';
import { isDarkOutside } from './lib/sun.js';
import { renderPulse } from './ui/pulse.js';
import { getWeather, weatherAdvice } from './lib/weather.js';
import { createWalkWithMe, createWatchView } from './ui/walk.js';
import { createTour } from './ui/tour.js';
import { parseWatch } from './lib/walkwithme.js';
import { recordVisit, newBadges, BADGES, weeklyChallenges, weekStats, challengeProgress, weekKey } from './lib/challenges.js';
import { teamOptions, rankRows, previousWeek, winnerOf, isChampion } from './lib/leaderboard.js';
import { ACCESS_FEATURES, ACCESS_TYPES, OFFICIAL_ACCESS_MAP_URL } from './data/accessibility.js';
import { tagGraph, addTuRoutes, mergeBuildings, activeConstruction } from './lib/tu.js';
import { DemoBackend } from './lib/demo.js';
import { createNav, update as navUpdate, splitRoute, turnIcon, shortText, spokenDistance } from './lib/nav.js';
import { isNative, shareBase, initNative, startBackgroundLocation, stopBackgroundLocation, tap, stepPermission, requestStepPermission, stepHistory } from './native.js';

const CENTER = [39.3925, -76.6110];

// Guard Leaflet's fly-to animation. Its math produces NaN positions mid-flight
// ("Invalid LatLng (NaN, NaN)") with a zero-size map, a non-finite target, or a
// tiny move (e.g. re-flying to almost where the map already is). Tiny moves use
// a normal pan/zoom instead, which is what they should look like anyway.
const leafletFlyTo = L.Map.prototype.flyTo;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
L.Map.prototype.flyTo = function (center, zoom, options) {
  const c = L.latLng(center), size = this.getSize();
  const z = zoom === undefined ? this.getZoom() : zoom;
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return this;
  if (!size.x || !size.y || !Number.isFinite(z)) return this.setView(c, Number.isFinite(z) ? z : this.getZoom(), { animate: false });
  if (reducedMotion.matches) return this.setView(c, z, { animate: false }); // respect "reduce motion"
  const px = this.project(this.getCenter(), z).distanceTo(this.project(c, z));
  if (px < 200 && Math.abs(z - this.getZoom()) < 1) return this.setView(c, z, { animate: true });
  return leafletFlyTo.call(this, c, z, options);
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('tigerpath.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tigerpath.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const EDIT = new URLSearchParams(location.search).has('edit');
// Demo mode: ?demo (or #demo) shows a sample student; nothing is saved anywhere.
if (location.hash === '#demo') location.replace(`${location.pathname}?demo`);
const DEMO = new URLSearchParams(location.search).has('demo');

// ---------------------------------------------------------------- state
const S = {
  buildings: applyPinOverrides(BUILDINGS),
  graph: null, graphSource: 'seed', osm: null,
  tu: null, parking: PARKING, shuttles: SHUTTLES, // TU's official campus map data replaces these when loaded
  selected: null, room: null,
  from: null, to: null, profile: 'standard', lastRoute: null,
  me: null, live: false, watchId: null,
  category: null,
  layers: { buildings: true, labels: true, parking: true, shuttle: false, safety: true, outlines: true, access: false, ...store.get('layers', {}) },
  permit: '', basemap: store.get('basemap', 'map'),
  day: WEEKDAYS.includes(DAYS[new Date().getDay()]) ? DAYS[new Date().getDay()] : 'mon',
};
// Account (or guest) data: favorites, recent, schedule, goals, activity, settings.
const acc = new AccountService(null);
Object.defineProperties(S, {
  favs: { get: () => acc.data.favs },
  recent: { get: () => acc.data.recent },
  schedule: { get: () => acc.data.schedule },
  settings: { get: () => acc.data.settings },
  pace: { get: () => acc.data.settings.pace ?? store.get('pace', 1.34) },
  units: { get: () => acc.data.settings.units ?? store.get('units', 'imperial') },
});
const byId = new Map(S.buildings.map((b) => [b.id, b]));
const parkingById = new Map(PARKING.map((p) => [p.id, p]));
// parking ids used before TU's official data (old shared links) -> official ids
const LEGACY_PARKING = { 'P-UG': 'P-UPG', 'P-TTG': 'P-TTPG', 'P-GG': 'P-GPG' };
/** Short code shown on pins and lists (TU's code for buildings from TU's map). */
const tag = (b) => b.tag ?? b.id;
/** Parking as a search result: found by "parking", "garage", "visitor parking" or its name; visitor garages first. */
const parkingSearchItem = (p) => ({
  id: p.id, name: p.name, category: 'parking', tag: 'P', parking: true,
  aliases: ['parking', p.kind === 'garage' ? 'garage' : 'lot', ...(p.visitor ? ['visitor parking'] : []), ...(p.code ? [p.code] : [])],
  sub: [p.kind === 'garage' ? 'Parking garage' : 'Parking lot',
    p.visitor ? (typeof p.visitor === 'number' ? `${p.visitor} visitor spaces` : 'Visitor parking') : p.permits.map((x) => PERMIT_LABELS[x] ?? x).join(', ')].filter(Boolean).join(' · '),
  boost: (p.visitor ? 3 : 0) + (p.kind === 'garage' ? 2 : 0),
});
const buildIndex = () => createIndex([...S.buildings, ...S.parking.map(parkingSearchItem)]);
let index = buildIndex();
const safety = [...SAFETY];

// ---------------------------------------------------------------- map
const map = L.map('map', { zoomControl: false, maxZoom: 20, minZoom: 13 }).setView(CENTER, 16);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ position: 'bottomright', imperial: true, metric: true }).addTo(map);

// Street map: self-hosted vector tiles in public/tiles (built monthly by the
// "Build self-hosted map" workflow from Protomaps' free OpenStreetMap builds) —
// no API key, no third-party tile server. Falls back to OpenStreetMap's tile
// server only if the tiles are missing.
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE = {
  map: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM_ATTR, 19],
  satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Imagery © Esri, Maxar, Earthstar Geographics', 19],
};
let baseLayer, selfHosted = null;
async function loadBasemapMeta() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tiles/meta.json`);
    if (res.ok && res.headers.get('content-type')?.includes('json')) selfHosted = await res.json();
  } catch { /* fall back to the OSM tile server */ }
  if (selfHosted) {
    const [w, s_, e, n] = selfHosted.bounds;
    map.setMaxBounds(L.latLngBounds([s_, w], [n, e]).pad(0.15));
  }
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function setBasemap(kind = S.basemap) {
  if (!TILE[kind]) kind = 'map'; // older saved choices ('auto', 'osm') → street map
  S.basemap = kind; store.set('basemap', kind);
  if (baseLayer) map.removeLayer(baseLayer);
  if (kind === 'map' && selfHosted) {
    baseLayer = leafletLayer({
      url: `${import.meta.env.BASE_URL}tiles/{z}/{x}/{y}.mvt`, flavor: isDark() ? 'dark' : 'light', lang: 'en',
      maxDataZoom: selfHosted.maxzoom, maxZoom: 20,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2), // 3× iPhone canvases can exceed Safari's canvas memory limit
      attribution: `${OSM_ATTR} · <a href="https://protomaps.com">Protomaps</a>`,
    }).addTo(map);
  } else {
    const [url, attribution, maxNativeZoom] = TILE[kind];
    baseLayer = L.tileLayer(url, { attribution, maxZoom: 20, maxNativeZoom, className: kind === 'map' ? 'street-tiles' : '' }).addTo(map);
  }
  baseLayer.bringToBack?.();
  renderSeg('#basemaps', [['map', 'Map'], ['satellite', 'Satellite']], S.basemap, setBasemap);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S.basemap === 'map' && selfHosted && setBasemap('map'));

const layers = {
  outlines: L.layerGroup(), buildings: L.layerGroup(), parking: L.layerGroup(),
  shuttle: L.layerGroup(), safety: L.layerGroup(), access: L.layerGroup(), route: L.layerGroup().addTo(map), tour: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map),
};
const markers = new Map();

/** Space the panel covers, so fitted routes stay visible. Never more than leaves 120 px of map. */
function padding() {
  const size = map.getSize();
  const tl = isMobile() ? [20, 70] : [430, 30];
  const br = isMobile() ? [20, $('#panel').offsetHeight + 20] : [70, 30];
  for (const [axis, avail] of [[0, size.x - 120], [1, size.y - 120]]) {
    const total = tl[axis] + br[axis];
    if (total > avail) { const k = Math.max(0, avail) / total; tl[axis] *= k; br[axis] *= k; }
  }
  return { paddingTopLeft: tl, paddingBottomRight: br };
}
/** Animate the map to show `bounds` — safely (a hidden or zero-size map would produce NaN positions). */
function fitView(bounds, maxZoom = 18) {
  const size = map.getSize();
  if (!size.x || !size.y || !bounds?.isValid?.()) return;
  map.flyToBounds(bounds, { ...padding(), maxZoom, duration: 0.6 });
}
function flyTo(latlng, zoom = 18) { fitView(L.latLng(latlng).toBounds(60), zoom); }

function buildingIcon(b) {
  const c = CATEGORIES[b.category]?.color ?? '#333';
  const cls = ['bmark'];
  if (S.selected === b.id) cls.push('sel');
  if (S.category && b.category !== S.category) cls.push('dim');
  return L.divIcon({ className: b.extra ? 'zd' : '', html: `<div class="${cls.join(' ')}" style="background:${c}">${esc(tag(b))}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}
function drawBuildings() {
  layers.buildings.clearLayers(); markers.clear();
  for (const b of S.buildings) {
    const m = L.marker([b.lat, b.lng], { icon: buildingIcon(b), title: b.name, alt: b.name, keyboard: true, riseOnHover: true })
      .bindTooltip(b.name, { permanent: true, direction: 'bottom', offset: [0, 14], className: 'blabel' })
      .on('click', () => selectBuilding(b.id));
    m.building = b;
    markers.set(b.id, m);
    layers.buildings.addLayer(m);
  }
  updateLabels();
}
const refreshMarkers = () => markers.forEach((m) => m.setIcon(buildingIcon(m.building)));
function updateLabels() {
  const show = S.layers.labels && map.getZoom() >= 17;
  map.getContainer().classList.toggle('hide-labels', !show);
  map.getContainer().classList.toggle('hide-detail', map.getZoom() < 17); // phones, AEDs, off-campus lots
  map.getContainer().classList.toggle('far-out', map.getZoom() < 15); // town view: one campus marker instead of 45 pins
}
map.on('zoomend', updateLabels);
document.head.insertAdjacentHTML('beforeend', '<style>.hide-labels .blabel{display:none}.hide-detail .zd{display:none}.far-out .bmark,.far-out .pmark{display:none}.campus-wrap{display:none}.far-out .campus-wrap{display:block}.campus-pin{display:flex}</style>');
L.marker(CENTER, { icon: L.divIcon({ className: 'campus-wrap', html: '<div class="campus-pin"><span>TU</span>Towson University</div>', iconSize: [190, 36], iconAnchor: [95, 18] }), title: 'Zoom in to Towson University', keyboard: true, zIndexOffset: 2000 })
  .on('click', () => { if (map.getSize().x) map.flyTo(CENTER, 16); }).addTo(map);

function drawParking() {
  layers.parking.clearLayers();
  const osmLots = S.tu ? [] : (S.osm?.parking ?? []).filter((p) => p.name && p.name !== 'Parking' && !S.parking.some((q) => distance(p, q) < 60)).map((p, i) => ({ ...p, id: 'osm-p' + i, kind: 'lot', permits: [], fromOsm: true }));
  for (const p of [...S.parking, ...osmLots]) {
    if (S.permit && !p.permits.includes(S.permit)) continue;
    if (p.outline) L.polygon(p.outline, { color: '#475569', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layers.parking);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: p.fromOsm || p.kind === 'lot' ? 'zd' : '', html: '<div class="pmark">P</div>', iconSize: [24, 24] }), title: p.name })
      .bindPopup(parkingPopup(p))
      .addTo(layers.parking);
    if (!parkingById.has(p.id)) parkingById.set(p.id, p);
  }
}
function parkingPopup(p) {
  const n = (x) => (typeof x === 'number' ? x.toLocaleString() : '');
  const permits = p.permits.map((x) => PERMIT_LABELS[x] ?? x).join(', ') || 'See signage';
  return `<b>${esc(p.name)}</b><br><span class="muted">${p.kind === 'garage' ? 'Garage' : 'Lot'} · ${esc(permits)}</span>
    ${p.spaces ? `<br>${n(p.spaces)} spaces` : ''}${p.visitor ? `<br>🎟️ ${typeof p.visitor === 'number' ? `${n(p.visitor)} visitor spaces` : 'Visitor parking'}` : ''}
    ${p.ev ? `<br>⚡ ${typeof p.ev === 'number' ? `${p.ev} EV charging spaces` : 'EV charging'}` : ''}${p.accessible ? `<br>♿ ${typeof p.accessible === 'number' ? `${p.accessible} accessible spaces` : 'Accessible spaces'}` : ''}${p.note ? `<br>${esc(p.note)}` : ''}
    ${S.tu ? '<br><a href="https://www.towson.edu/parking/" target="_blank" rel="noopener">Permits &amp; rules ↗</a>' : ''}
    <div class="ctx-menu"><button data-route-to="parking:${esc(p.id)}">Directions here</button><button data-route-from="parking:${esc(p.id)}">Walk from here</button></div>`;
}
/** A garage or lot picked in search: fly there and open its details, even with the Parking layer off. */
function showParking(id) {
  const p = parkingById.get(id); if (!p) return;
  if (S.selected) { S.selected = null; S.room = null; refreshMarkers(); renderDetail(); writeHash(); }
  sheet('peek'); // room on the map for the details card
  setTimeout(() => {
    map.once('moveend', () => L.popup({ autoPanPaddingTopLeft: [12, 60] }).setLatLng([p.lat, p.lng]).setContent(parkingPopup(p)).openOn(map));
    flyTo([p.lat, p.lng], 17);
  }, isMobile() ? 260 : 0); // after the sheet has slid down, so the map centres in the space left
}
function drawShuttles() {
  layers.shuttle.clearLayers();
  const stops = []; // one marker per stop, listing every line that serves it
  for (const r of S.shuttles) {
    const lines = r.lines ?? [[...r.stops.map((s) => [s.lat, s.lng]), [r.stops[0].lat, r.stops[0].lng]]];
    for (const l of lines) L.polyline(l, { color: r.color, weight: 5, opacity: 0.85, dashArray: r.sample ? '8 8' : null }).bindTooltip(`${r.name} shuttle`).addTo(layers.shuttle);
    for (const s of r.stops) {
      const same = stops.find((x) => distance(x, s) < 20);
      if (same) { if (!same.routes.includes(r)) same.routes.push(r); } else stops.push({ ...s, routes: [r] });
    }
  }
  for (const s of stops) {
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="smark" aria-hidden="true">🚌</div>', iconSize: [22, 22] }), title: `Shuttle stop: ${s.name}` })
      .bindPopup(`<b>🚌 ${esc(s.name)}</b><br>${s.routes.map((r) => `<span class="tag" style="border-color:${r.color}">${esc(r.name)}</span>`).join(' ')}
        <br><a href="${LIVE_SHUTTLE_URL}" target="_blank" rel="noopener">Schedules &amp; live arrivals ↗</a>
        <div class="ctx-menu"><button data-route-to="pt:${s.lat},${s.lng}" data-label="${esc(`shuttle stop ${s.name}`)}">Directions here</button></div>`).addTo(layers.shuttle);
  }
}
function drawSafety() {
  layers.safety.clearLayers();
  for (const s of safety) {
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'zd', html: `<div class="dot" style="background:${s.kind === 'aed' ? '#b91c1c' : '#1d4ed8'}" aria-hidden="true"></div>`, iconSize: [12, 12] }), title: s.kind === 'aed' ? 'AED' : 'Emergency phone', alt: s.name })
      .bindPopup(`<b>${s.kind === 'aed' ? '❤️ AED' : '☎️ Emergency phone'}</b>${s.name && !/^(AED|Emergency phone)$/.test(s.name) ? `<br>${esc(s.name)}` : ''}${s.where ? `<br>${esc(s.where)}` : ''}`).addTo(layers.safety);
  }
}
function drawOutlines() {
  layers.outlines.clearLayers();
  for (const c of activeConstruction(S.tu)) {
    L.polygon(c.polygon, { color: '#ea580c', weight: 2, dashArray: '6 4', fillColor: '#fb923c', fillOpacity: 0.18 })
      .bindPopup(`<b>🚧 Construction: ${esc(c.name ?? 'work area')}</b>${c.opens ? `<br>Expected to open ${esc(c.opens)}` : ''}<br><span class="muted">Paths nearby may be fenced off.</span>${c.link ? `<br><a href="${esc(c.link)}" target="_blank" rel="noopener">Campus construction ↗</a>` : ''}`)
      .addTo(layers.outlines);
  }
  for (const o of S.osm?.buildings ?? []) {
    const match = o.ourId && byId.get(o.ourId);
    L.polygon(o.outline, { weight: 1, color: match ? CATEGORIES[match.category].color : '#888', fillOpacity: match ? 0.25 : 0.08, interactive: !!match })
      .on('click', () => match && selectBuilding(match.id)).addTo(layers.outlines);
  }
}
// ---------------------------------------------------------------- accessibility
let localAccess = [];
try { localAccess = EDIT ? JSON.parse(localStorage.getItem('tigerpath.access')) ?? [] : []; } catch { /* none */ }
const doorName = (e) => (e.name && e.name !== e.buildingName ? e.name.replace(new RegExp(`^${e.buildingName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\((.*)\\)$`), '$1') : '');
const tuEntrances = () => (S.tu?.entrances ?? []).filter((e) => e.building).map((e) => ({
  type: e.opener ? 'automatic-door' : 'entrance', lat: e.lat, lng: e.lng, building: e.building, tu: true, where: doorName(e),
  note: [e.name && e.name !== e.buildingName ? e.name : null, e.opener ? 'automatic door opener' : null, e.steps ? 'steps' : 'no steps', e.note].filter(Boolean).join(' · '),
}));
const accessFeatures = () => [...ACCESS_FEATURES, ...localAccess, ...tuEntrances()];
const accessEntrances = (id) => accessFeatures().filter((f) => f.building === id && (f.type === 'entrance' || f.type === 'automatic-door'));
const canvas = L.canvas({ padding: 0.3 });

/** Step-free footpaths, stairs to avoid, rough surfaces, curb cuts, accessible parking, ramps/entrances/elevators. */
function drawAccess() {
  layers.access.clearLayers();
  if (S.tu) drawTuAccess();
  else if (S.osm) {
    const groups = { good: [], ok: [], rough: [], stairs: [] };
    for (const [a, list] of S.graph.adj) for (const e of list) {
      if (a > e.to || !e.path) continue;
      const A = S.graph.nodes.get(a), B = S.graph.nodes.get(e.to);
      const seg = [[A.lat, A.lng], [B.lat, B.lng]];
      if (e.stairs || e.wheelchair === 'no' || e.kerb === 'raised') groups.stairs.push(seg);
      else if (e.rough || e.steep) groups.rough.push(seg);
      else if (e.ramp || e.wheelchair === 'yes') groups.good.push(seg);
      else groups.ok.push(seg);
    }
    const line = (segs, style, tip) => segs.length && L.polyline(segs, { renderer: canvas, interactive: false, ...style }).addTo(layers.access) && tip;
    line(groups.ok, { color: '#7c3aed', weight: 3, opacity: 0.55 });
    line(groups.good, { color: '#5b21b6', weight: 5, opacity: 0.9 });
    line(groups.rough, { color: '#a16207', weight: 3, opacity: 0.9, dashArray: '2 5' });
    line(groups.stairs, { color: '#dc2626', weight: 4, opacity: 0.95, dashArray: '4 5' });
    for (const [lat, lng] of S.osm.access?.curbCuts ?? []) L.circleMarker([lat, lng], { renderer: canvas, radius: 3, color: '#fff', weight: 1, fillColor: '#5b21b6', fillOpacity: 1, interactive: false }).addTo(layers.access);
    for (const p of S.osm.access?.parking ?? []) {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="pmark access">♿</div>', iconSize: [24, 24] }), title: 'Accessible parking' })
        .bindPopup(`<b>♿ Accessible parking</b><br>${p.capacity} space${p.capacity > 1 ? 's' : ''}${p.lot ? ` · ${esc(p.lot)}` : ''}<div class="ctx-menu"><button data-route-to="pt:${p.lat},${p.lng}">Directions here</button></div>`).addTo(layers.access);
    }
  }
  for (const f of accessFeatures()) {
    if (f.tu) continue; // drawn by drawTuAccess with TU's details
    const t = ACCESS_TYPES[f.type] ?? { label: f.type, icon: '♿' };
    L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: `<div class="amark" aria-hidden="true">${t.icon}</div>`, iconSize: [24, 24] }), title: t.label })
      .bindPopup(`<b>${t.icon} ${esc(t.label)}</b>${f.building ? `<br>${esc(byId.get(f.building)?.name ?? f.building)}` : ''}${f.note ? `<br>${esc(f.note)}` : ''}${f.verified ? `<br><span class="muted">Checked ${esc(f.verified)}</span>` : ''}`)
      .addTo(layers.access);
  }
}

/** TU's accessibility survey: rated routes, stairs, accessible entrances, parking and paratransit stops. */
const TU_RATING = { yes: ['#5b21b6', 5, null, 'Accessible'], limited: ['#a16207', 4, '2 5', 'Limited accessibility'], no: ['#dc2626', 4, '4 5', 'Not accessible'] };
function drawTuAccess() {
  const byRating = { yes: [], limited: [], no: [] };
  for (const r of S.tu.accessRoutes) byRating[r.rating]?.push(r.line);
  for (const [k, segs] of Object.entries(byRating)) {
    const [color, weight, dashArray] = TU_RATING[k];
    if (segs.length) L.polyline(segs, { renderer: canvas, color, weight, dashArray, opacity: 0.9, interactive: false }).addTo(layers.access);
  }
  for (const [lat, lng] of S.tu.stairs) L.circleMarker([lat, lng], { renderer: canvas, radius: 3.5, color: '#fff', weight: 1, fillColor: '#dc2626', fillOpacity: 1, interactive: false }).addTo(layers.access);
  for (const e of S.tu.entrances) {
    const b = byId.get(e.building);
    L.marker([e.lat, e.lng], { icon: L.divIcon({ className: 'zd', html: '<div class="amark door" aria-hidden="true">♿</div>', iconSize: [18, 18] }), title: `Accessible entrance: ${e.name ?? e.buildingName}` })
      .bindPopup(`<b>♿ Accessible entrance</b><br>${esc(b?.name ?? e.buildingName)}${e.name && e.name !== e.buildingName ? ` — ${esc(e.name)}` : ''}
        <br>${e.opener ? 'Automatic door opener' : 'No automatic opener'}${e.door ? ` · ${esc(e.door.toLowerCase())}` : ''} · ${e.steps ? 'steps' : 'no steps'}${e.note ? `<br>${esc(e.note)}` : ''}
        <div class="ctx-menu"><button data-route-to="pt:${e.lat},${e.lng}" data-label="${esc(`${b?.name ?? e.buildingName} (accessible entrance)`)}">Directions here</button></div>`).addTo(layers.access);
  }
  for (const p of S.tu.accessParking) {
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'zd', html: '<div class="pmark access" aria-hidden="true">♿</div>', iconSize: [24, 24] }), title: 'Accessible parking' })
      .bindPopup(`<b>♿ Accessible parking</b><br>${esc(p.name ?? p.lot)}${p.spaces ? `<br>${p.spaces} space${p.spaces > 1 ? 's' : ''}` : ''}${p.floor ? ` · ${esc(p.floor)}` : ''}
        <div class="ctx-menu"><button data-route-to="pt:${p.lat},${p.lng}" data-label="${esc(`accessible parking, ${p.name ?? p.lot}`)}">Directions here</button></div>`).addTo(layers.access);
  }
  for (const p of S.tu.paratransit) {
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'zd', html: '<div class="amark para" aria-hidden="true">🚐</div>', iconSize: [24, 24] }), title: `Paratransit stop: ${p.name}` })
      .bindPopup(`<b>🚐 Paratransit stop</b><br>${esc(p.name)}<br><a href="https://www.towson.edu/parking/shuttle/paratransit.html" target="_blank" rel="noopener">Paratransit service ↗</a>`).addTo(layers.access);
  }
}

function applyLayers() {
  for (const k of ['outlines', 'buildings', 'parking', 'shuttle', 'safety', 'access']) {
    if (S.layers[k]) layers[k].addTo(map); else map.removeLayer(layers[k]);
  }
  updateLabels();
  store.set('layers', S.layers);
}

// ---------------------------------------------------------------- routing graph
function buildGraph() {
  const pts = [...S.buildings, ...S.parking].map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name }));
  if (S.osm) {
    S.graph = graphFromProcessed(S.osm);
    S.tuTagged = tagGraph(S.graph, S.tu); // TU's accessibility survey: rated routes and stairs
    // the walkway network everyone can use; isolated fragments (gated fields, private drives) are ignored.
    // Measured before TU's surveyed paths are added, so places always link to the main OpenStreetMap network.
    const walk = S.graph.mainComponent();
    S.tuTagged.added = addTuRoutes(S.graph, S.tu); // …and the surveyed paths OpenStreetMap lacks
    for (const n of S.graph.nodes.keys()) if (isTuNode(n)) walk.add(n); // reachable for step-free routes
    for (const p of pts) { // connect each place to the 2 nearest walkway nodes
      const near = S.graph.nearest(p, 2, (n) => walk.has(n.id) && !isTuNode(n.id));
      S.graph.addNode(p.id, p.lat, p.lng, p.label);
      for (const n of near) if (n.d < 200) S.graph.addEdge(p.id, n.id);
    }
    S.graphSource = 'osm';
    S.mainNodes = walk;
  } else {
    S.graph = buildSeedGraph(pts);
    S.graphSource = 'seed';
    S.mainNodes = S.graph.mainComponent();
  }
  // precompute "near an emergency phone" for well-lit routing
  const phones = safety.filter((s) => s.kind === 'phone');
  if (phones.length) {
    for (const [a, list] of S.graph.adj) for (const e of list) {
      const A = S.graph.nodes.get(a), B = S.graph.nodes.get(e.to);
      const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
      e.nearPhone = phones.some((p) => distance(p, mid) < 90);
    }
  }
  // active closures block the edges they touch
  const today = new Date().toISOString().slice(0, 10);
  for (const c of CLOSURES.filter((c) => c.until >= today && c.blocksPaths)) {
    const poly = L.polygon(c.polygon);
    for (const [a, list] of S.graph.adj) for (const e of list) {
      const A = S.graph.nodes.get(a), B = S.graph.nodes.get(e.to);
      if (poly.getBounds().contains([(A.lat + B.lat) / 2, (A.lng + B.lng) / 2])) e.closed = true;
    }
  }
}

let tmpSeq = 0;
/** Nodes of TU's surveyed paths: places link to regular walkways, never straight onto these. */
const isTuNode = (id) => typeof id === 'string' && id.startsWith('tu:');
/** Resolve a place to a graph node id. Returns { id, label, latlng, cleanup }. */
function placeNode(place, door = null) {
  if (!place) return null;
  if (place.type === 'building') {
    const b = byId.get(place.id); if (!b) return null;
    if (door) return placeNode({ type: 'point', lat: door.lat, lng: door.lng, label: `${b.name} (accessible entrance)`, door: true }); // ♿ route to a listed accessible entrance
    return { id: b.id, label: b.name, latlng: [b.lat, b.lng], cleanup() {} };
  }
  if (place.type === 'parking') { const p = parkingById.get(place.id); return p && S.graph.nodes.has(p.id) && { id: p.id, label: p.name, latlng: [p.lat, p.lng], cleanup() {} }; }
  const pt = place.type === 'me' ? S.me : place;
  if (!pt) return null;
  const id = '@tmp' + ++tmpSeq;
  const near = S.graph.nearest(pt, 3, (n) => S.mainNodes.has(n.id) && !isTuNode(n.id));
  if (!near.length || near[0].d > 300) return { far: true, cleanup() {} }; // walking paths only cover campus; don't invent long straight-line links
  if (place.door) { // an accessible entrance also joins TU's surveyed accessible route next to it
    const tuNode = S.graph.nearest(pt, 1, (n) => isTuNode(n.id) && S.mainNodes.has(n.id))[0];
    if (tuNode && tuNode.d < 40 && !near.some((n) => n.id === tuNode.id)) near.push(tuNode);
  }
  S.graph.addNode(id, pt.lat, pt.lng);
  near.forEach((n) => S.graph.addEdge(id, n.id));
  const label = place.type === 'me' ? 'your location' : place.label ?? 'dropped pin';
  return { id, label, latlng: [pt.lat, pt.lng], cleanup() { near.forEach((n) => S.graph.removeEdge(id, n.id)); S.graph.nodes.delete(id); S.graph.adj.delete(id); } };
}
const speed = () => S.pace; // one pace for every option, so times compare fairly (set in My account)
/** Step-free routes start/end at a building's accessible entrances (up to 4 tried, the shortest wins). */
function doorsFor(place, profile) {
  if (profile !== 'accessible' || place?.type !== 'building') return [null];
  const doors = accessEntrances(place.id);
  return doors.length ? doors.slice(0, 4) : [null];
}
function computeRoute(fromPlace, toPlace, profile = 'standard', extra = {}) {
  let best = null;
  for (const fd of doorsFor(fromPlace, profile)) for (const td of doorsFor(toPlace, profile)) {
    const r = routeVia(fromPlace, toPlace, profile, extra, fd, td);
    if (!best || (r?.res && (!best.res || r.res.dist < best.res.dist))) best = r;
  }
  return best;
}
function routeVia(fromPlace, toPlace, profile, extra, fromDoor, toDoor) {
  const a = placeNode(fromPlace, fromDoor), b = placeNode(toPlace, toDoor);
  try {
    if (!a || !b) return null;
    if (a.far || b.far) return { far: true, a, b, res: null };
    const res = route(S.graph, a.id, b.id, profile, { phones: safety.some((s) => s.kind === 'phone'), strict: !!S.settings.strictAccess, noStairs: !!S.settings.avoidStairs, ...extra });
    if (!res) return { a, b, res: null };
    const latlngs = res.path.map((id) => { const n = S.graph.nodes.get(id); return [n.lat, n.lng]; });
    return { a, b, res, latlngs, steps: directions(S.graph, res, { fromLabel: a.label, toLabel: b.label }), minutes: res.dist / speed(profile) / 60 };
  } finally { a?.cleanup(); b?.cleanup(); }
}
const walkCache = new Map();
function walkMinutes(fromId, toId) {
  const k = `${fromId}>${toId}>${S.pace}`;
  if (!walkCache.has(k)) walkCache.set(k, computeRoute({ type: 'building', id: fromId }, { type: 'building', id: toId }, 'standard')?.minutes ?? null);
  return walkCache.get(k);
}

// ---------------------------------------------------------------- tabs & sheet
const TABS = ['explore', 'directions', 'schedule', 'activity', 'layers'];
/** name: a tab, or 'account' (My account, opened from the header button). */
function showTab(name) {
  for (const t of TABS) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`#view-${t}`).hidden = t !== name;
  }
  $('#view-account').hidden = name !== 'account';
  $('#view-tour').hidden = name !== 'tour';
  map.getContainer().classList.toggle('touring', name === 'tour'); // fade regular pins so the tour stops stand out
  if (name !== 'tour') layers.tour.clearLayers();
  $('#acctBtn').setAttribute('aria-pressed', String(name === 'account'));
  if (name !== S.tab) $('.views').scrollTop = 0; // the tabs share one scroller: each opens at its top
  S.tab = name;
  if (name === 'schedule') renderSchedule();
  if (name === 'account' || name === 'activity') meView?.render();
  if (name === 'account') sheet('full');
  if (name === 'tour') { sheet('half'); tour.start(); }
  if (name === 'explore' && !S.selected) renderPulseNow(); // fresh next-class times and Hall Cup
  if (name !== 'directions' && name !== 'schedule') layers.route.clearLayers();
  if (name === 'directions' && S.options) drawRoutes();
  writeHash();
}
TABS.forEach((t) => $(`#tab-${t}`).addEventListener('click', () => showTab(t)));
$('#acctBtn').addEventListener('click', () => showTab(S.tab === 'account' ? 'explore' : 'account'));
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const i = Math.max(0, TABS.indexOf(S.tab ?? 'explore')) + (e.key === 'ArrowRight' ? 1 : -1);
  const t = TABS[(i + TABS.length) % TABS.length]; showTab(t); $(`#tab-${t}`).focus();
});
const SHEET = ['peek', 'half', 'full'];
let sheetDragged = false;
$('#sheetHandle').addEventListener('click', () => {
  if (sheetDragged) return; // the drag already picked a size
  const p = $('#panel'); p.dataset.sheet = SHEET[(SHEET.indexOf(p.dataset.sheet) + 1) % 3];
});
const sheet = (s) => { if (isMobile()) $('#panel').dataset.sheet = s; };
$('#sheetDown').addEventListener('click', () => { sheet('peek'); $('#sheetHandle').focus(); });
// Drag the handle or the header up and down like an iOS sheet; it settles on the nearest size,
// and a quick flick that wouldn't reach another size moves one size in its direction.
for (const grip of [$('#sheetHandle'), $('#panel .brand')]) {
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    sheetDragged = false;
    if (!isMobile() || e.target.closest('.brand button')) return;
    drag = { y: e.clientY, h: $('#panel').offsetHeight, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.lastY = e.clientY; drag.lastT = e.timeStamp;
    const dy = e.clientY - drag.y;
    if (!sheetDragged && Math.abs(dy) < 6) return;
    sheetDragged = true;
    const p = $('#panel'); p.classList.add('dragging');
    p.style.height = `${Math.min(innerHeight - 40, Math.max(120, drag.h - dy))}px`;
  });
  const end = () => {
    const d = drag; drag = null;
    if (!d || !sheetDragged) return;
    const p = $('#panel');
    const sizes = [150, innerHeight * 0.52, innerHeight - 40];
    const h = p.offsetHeight, speed = (d.y - d.lastY) / Math.max(1, d.lastT - d.t); // px/ms, up is positive
    let i = sizes.reduce((best, s, j) => (Math.abs(s - h) < Math.abs(sizes[best] - h) ? j : best), 0);
    const from = SHEET.indexOf(p.dataset.sheet);
    if (Math.abs(speed) > 0.5 && i === from) i = Math.max(0, Math.min(2, from + Math.sign(speed))); // a short flick still moves
    p.classList.remove('dragging'); p.style.height = '';
    p.dataset.sheet = SHEET[i];
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('lostpointercapture', end); // also covers a cancelled touch or a dropped capture
}

// ---------------------------------------------------------------- generic UI helpers
function renderSeg(sel, options, current, onPick) {
  const el = $(sel);
  el.innerHTML = options.map(([v, label]) => `<button role="radio" aria-checked="${v === current}" data-v="${esc(v)}">${esc(label)}</button>`).join('');
  el.onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v != null) onPick(v); };
}
// Toasts: a short message at the bottom of the screen, clear of the tabs and the turn banner. They queue
// rather than replace each other; `action` ({ label, run }) adds a button such as Undo.
const toastQueue = [];
let toastTimer = null;
function toast(msg, ms = 2600, action = null) {
  if (toastTimer && $('#toast').dataset.msg === msg) return; // already showing
  toastQueue.push({ msg, ms, action });
  if (toastQueue.length > 3) toastQueue.shift(); // a burst keeps only the latest few
  if (!toastTimer) nextToast();
}
function nextToast() {
  const t = $('#toast'), next = toastQueue.shift();
  clearTimeout(toastTimer);
  if (!next) { t.hidden = true; toastTimer = null; return; }
  t.dataset.msg = next.msg; t.textContent = next.msg;
  if (next.action) {
    const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = next.action.label;
    b.onclick = () => { next.action.run(); nextToast(); };
    t.append(b);
  }
  t.style.bottom = document.body.classList.contains('navigating') ? `${$('#navBottom').offsetHeight + 12}px` : '';
  t.hidden = false;
  toastTimer = setTimeout(nextToast, toastQueue.length ? Math.min(next.ms, 2600) : next.ms); // don't hold up the next one
}
/** This screen's link (the public website's address, also inside the iPhone app). */
const shareUrl = () => shareBase() + location.search + location.hash;
async function share(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
}

/** A search result's second line: what matched ("🍴 Starbucks") when it wasn't the name, else its offices. */
function resultSub({ b, why }) {
  if (b.sub) return b.sub;
  const label = CATEGORIES[b.category].label;
  if (why?.kind === 'food') return `${label} · 🍴 ${why.text}`;
  if (why?.kind === 'amenity') return `${label} · ${AMENITY_LABELS[why.text] ?? why.text}`;
  if (why?.kind === 'dept') return `${label} · ${why.text}`;
  return label + (b.depts?.length ? ' · ' + b.depts.slice(0, 2).join(', ') : '');
}
/** Typeahead on an input. onPick(item) gets { type, id, ... }. */
function attachTypeahead(input, list, onPick, { allowMe = false } = {}) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const render = () => {
    const q = input.value.trim();
    items = q ? search(index, q).map((r) => ({ type: r.item.parking ? 'parking' : 'building', id: r.item.id, b: r.item, room: r.room, why: r.why })) : [];
    if (allowMe && (!q || 'my location'.startsWith(q.toLowerCase()))) items.unshift({ type: 'me' });
    if (!items.length) {
      list.innerHTML = q ? '<li class="muted" aria-disabled="true">No matches. Try a building, an office, food or “parking”.</li>' : '';
      list.hidden = !q; return;
    }
    list.innerHTML = items.map((it, i) => it.type === 'me'
      ? `<li role="option" id="${list.id || input.id}-o${i}" data-i="${i}"><span class="code">📍</span><div>My location</div></li>`
      : `<li role="option" id="${list.id || input.id}-o${i}" data-i="${i}"><span class="code">${esc(tag(it.b))}</span><div>${esc(it.b.name)}${it.room ? ` · Room ${esc(it.room.room)}` : ''}
          <div class="sub">${esc(resultSub(it))}</div></div></li>`).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const highlight = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({ block: 'nearest' }); }
  };
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) { onPick(it); close(); } e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => { // mousedown so it fires before blur
    const li = e.target.closest('li[data-i]'); if (!li) return;
    e.preventDefault(); onPick(items[+li.dataset.i]); close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

// ---------------------------------------------------------------- explore
function renderChips() {
  const el = $('#chips');
  el.innerHTML = Object.entries(CATEGORIES).filter(([k]) => k !== 'parking')
    .map(([k, c]) => `<button class="chip" aria-pressed="${S.category === k}" data-c="${k}">${c.icon} ${c.label}</button>`).join('');
  el.onclick = (e) => {
    const c = e.target.closest('button')?.dataset.c; if (!c) return;
    S.category = S.category === c ? null : c;
    renderChips(); refreshMarkers();
    if (S.category) {
      const bs = S.buildings.filter((b) => b.category === S.category);
      fitView(L.latLngBounds(bs.map((b) => [b.lat, b.lng])));
      renderCategoryList(bs);
    } else renderHome();
  };
}
/** The Explore home (greeting above search, Campus Pulse below) or a building's details. */
const showHome = (on) => { $('#home').hidden = !on; $('#greet').hidden = !on; };
function renderCategoryList(bs) {
  $('#detail').hidden = true; showHome(true);
  $('#nearestOut').innerHTML = `<h2 class="h">${esc(CATEGORIES[S.category].label)} · ${bs.length}</h2><ul class="list">${bs.map((b) => {
    const st = openStatus(b.hours);
    return `<li><span class="code">${esc(tag(b))}</span><button class="link" data-b="${esc(b.id)}">${esc(b.name)}${st.label ? `<div class="sub ${st.open ? 'status open' : 'status closed'}" style="margin:0">${esc(st.label)}</div>` : ''}</button></li>`;
  }).join('')}</ul>`;
}

function selectBuilding(id, { room = null, fly = true } = {}) {
  const b = byId.get(id); if (!b) return;
  S.selected = id; S.room = room;
  if (document.activeElement !== $('#q')) $('#q').value = ''; // a name typed for another building would be stale
  acc.update((d) => { d.recent = [id, ...d.recent.filter((x) => x !== id)].slice(0, 6); });
  refreshMarkers();
  if (fly) flyTo([b.lat, b.lng]);
  if (S.tab !== 'explore') showTab('explore');
  renderDetail(); sheet('half'); writeHash();
}
function renderDetail() {
  const b = byId.get(S.selected);
  const el = $('#detail');
  if (!b) { el.hidden = true; showHome(true); return; }
  const cat = CATEGORIES[b.category];
  const st = openStatus(b.hours);
  const today = DAY_LABELS[DAYS[new Date().getDay()]];
  const fav = S.favs.includes(b.id);
  el.innerHTML = `
    <button class="back" id="backBtn">← Back</button>
    <div class="detail-head"><span class="code" style="background:${cat.color};color:#fff;font-size:.9rem;padding:6px 8px">${esc(tag(b))}</span>
      <div><h2>${esc(b.name)}</h2><span class="badge">${cat.icon} ${cat.label}</span></div></div>
    ${S.room ? `<div class="room-box"><b>Room ${esc(S.room.room)}</b> · ${typeof S.room.floor === 'number' ? `Floor ${S.room.floor}` : esc(S.room.floor)}
      <div class="sub muted">Room numbers usually start with the floor number. Elevators are near the main entrance.</div></div>` : ''}
    ${b.note ? `<div class="room-box">⚠️ ${esc(b.note)}</div>` : ''}
    ${st.label ? `<div class="status ${st.open ? (st.closingSoon ? 'soon' : 'open') : 'closed'}">${esc(st.label)} ${b.hours?.verified === false ? '<span class="unverified">(sample hours — verify)</span>' : ''}</div>` : ''}
    <div class="btn-row">
      <button class="btn primary" id="dirTo">Directions</button>
      <button class="btn" id="dirFrom">Start here</button>
      <button class="btn" id="favBtn" aria-pressed="${fav}">${fav ? '★ Saved' : '☆ Save'}</button>
      <button class="btn" id="shareBtn">Share</button>
    </div>
    ${b.tu?.address ? `<p class="muted" style="margin:6px 0 0">${esc(b.tu.address)}</p>` : ''}
    ${b.depts?.length ? `<h2 class="h">Inside</h2>${insideList(b)}` : ''}
    ${b.food?.length ? `<h2 class="h">Food here</h2><div>${b.food.map((f) => `<span class="tag">🍴 ${esc(f)}</span>`).join('')}</div>` : ''}
    ${b.amenities?.length ? `<h2 class="h">Amenities</h2><div>${b.amenities.map((a) => `<span class="tag">${esc(AMENITY_LABELS[a] ?? a)}</span>`).join('')}</div>` : ''}
    ${b.hours ? `<h2 class="h">Hours</h2><table class="hours">${weekTable(b.hours).map((r) => `<tr class="${r.day === today ? 'today' : ''}"><td>${r.day}</td><td>${esc(r.text)}</td></tr>`).join('')}</table>` : ''}
    <h2 class="h">♿ Accessibility</h2>${accessCard(b)}
    <h2 class="h">Nearby</h2><ul class="list" id="nearby"></ul>`;
  el.hidden = false; showHome(false);
  $('#backBtn').onclick = () => { S.selected = null; S.room = null; refreshMarkers(); renderDetail(); renderHome(); writeHash(); };
  $('#dirTo').onclick = () => { setPlace('to', { type: 'building', id: b.id }); if (!S.from && S.me) setPlace('from', { type: 'me' }); showTab('directions'); if (!S.from) $('#from').focus(); };
  $('#dirFrom').onclick = () => { setPlace('from', { type: 'building', id: b.id }); showTab('directions'); if (!S.to) $('#to').focus(); };
  $('#favBtn').onclick = () => { acc.update((d) => { d.favs = fav ? d.favs.filter((x) => x !== b.id) : [...d.favs, b.id]; }); renderDetail(); };
  $('#shareBtn').onclick = () => share(shareUrl(), b.name);
  $('#stepFree').onclick = () => { S.requestedKind = 'stepfree'; $('#dirTo').click(); };
  const near = S.buildings.filter((x) => x.id !== b.id).map((x) => ({ x, d: distance(b, x) })).sort((p, q) => p.d - q.d).slice(0, 4);
  $('#nearby').innerHTML = near.map(({ x, d }) => `<li><span class="code">${esc(tag(x))}</span><button class="link" data-b="${esc(x.id)}">${esc(x.name)}</button><span class="muted">${formatDistance(d, S.units)}</span></li>`).join('');
}

/** Offices and departments in a building; TU's ones link to their pages. Long lists fold away. */
function insideList(b) {
  const links = new Map((b.offices ?? []).map((o) => [o.name, o.link]));
  const tags = b.depts.map((d) => links.get(d) ? `<a class="tag" href="${esc(links.get(d))}" target="_blank" rel="noopener">${esc(d)}</a>` : `<span class="tag">${esc(d)}</span>`);
  if (tags.length <= 10) return `<div>${tags.join('')}</div>`;
  return `<div>${tags.slice(0, 8).join('')}</div><details class="more"><summary>${tags.length - 8} more offices</summary><div>${tags.slice(8).join('')}</div></details>`;
}

function accessCard(b) {
  const feats = accessFeatures().filter((f) => f.building === b.id);
  const nearest = (list) => list.map((p) => ({ p, d: distance(b, p) })).sort((x, y) => x.d - y.d)[0];
  const doors = feats.filter((f) => f.tu);
  const items = feats.filter((f) => !f.tu).map((f) => `<li>${ACCESS_TYPES[f.type]?.icon ?? '♿'} ${esc(ACCESS_TYPES[f.type]?.label ?? f.type)}${f.note ? ` — ${esc(f.note)}` : ''}</li>`);
  if (doors.length) {
    const allAuto = doors.every((d) => d.type === 'automatic-door');
    items.unshift(`<li>♿ ${doors.length} accessible entrance${doors.length > 1 ? 's' : ''}${allAuto ? `, ${doors.length > 1 ? 'all ' : ''}with automatic door openers` : ''}:
      <ul class="doors">${doors.map((d) => `<li>${esc(d.where || 'Main entrance')}</li>`).join('')}</ul></li>`);
  }
  if (S.tu) {
    const parking = nearest(S.tu.accessParking);
    if (parking && parking.d < 500) items.push(`<li>🅿️ Accessible parking ${formatDistance(parking.d, S.units)} away — ${esc(parking.p.name ?? parking.p.lot)}${parking.p.spaces ? ` (${parking.p.spaces} space${parking.p.spaces > 1 ? 's' : ''})` : ''}</li>`);
    const para = nearest(S.tu.paratransit);
    if (para && para.d < 500) items.push(`<li>🚐 Paratransit stop ${formatDistance(para.d, S.units)} away — ${esc(para.p.name)}</li>`);
  } else {
    const parking = nearest(S.osm?.access?.parking ?? []);
    if (parking && parking.d < 400) items.push(`<li>♿ Accessible parking ${formatDistance(parking.d, S.units)} away (${parking.p.capacity} space${parking.p.capacity > 1 ? 's' : ''})</li>`);
  }
  if (b.tu?.restrooms) items.push(`<li>🚻 All-gender restrooms: ${esc(b.tu.restrooms)}</li>`);
  if (b.tu?.lactation) items.push(`<li>🍼 Lactation room: ${esc(b.tu.lactation)}</li>`);
  return `<ul class="access-list">${items.join('') || '<li class="muted">No accessible entrances, ramps or elevators mapped for this building yet.</li>'}</ul>
    ${S.tu ? '<p class="hint">From TU’s official campus map (preliminary data, under review by TU).</p>' : ''}
    <div class="btn-row"><button class="btn small" id="stepFree">♿ Step-free route here</button>
    <a class="btn small" href="${S.tu ? 'https://maps.towson.edu/' : OFFICIAL_ACCESS_MAP_URL}" target="_blank" rel="noopener">TU campus map ↗</a></div>`;
}

function renderHome() {
  $('#nearestOut').innerHTML = '';
  renderPulseNow();
  const li = (id) => { const b = byId.get(id); return b ? `<li><span class="code">${esc(tag(b))}</span><button class="link" data-b="${esc(b.id)}">${esc(b.name)}</button></li>` : ''; };
  const home = byId.get(S.settings.home);
  $('#favs').innerHTML = (home ? `<li><span class="code">🏠</span><button class="link" data-b="${esc(home.id)}">${esc(home.name)}<div class="sub muted">Home</div></button>
      <button class="btn small" data-go='${esc(JSON.stringify({ type: 'building', id: home.id }))}'>Directions home</button></li>` : '')
    + (S.favs.map(li).join('') || (home ? '' : '<li class="muted">Tap ☆ on a building to save it, or set your home in My account.</li>'));
  $('#recent').innerHTML = S.recent.map(li).join('') || '<li class="muted">Nothing yet.</li>';
}

const QUICK = [
  { k: 'food', label: '🍽️ Food, open now', match: (b) => (b.category === 'dining' || b.amenities?.includes('food')), openOnly: true },
  { k: 'printing', label: '🖨️ Printing', match: (b) => b.amenities?.includes('printing') },
  { k: 'study', label: '📚 Study space', match: (b) => b.amenities?.includes('study') },
  { k: 'restroom', label: '🚻 Restrooms', match: (b) => b.amenities?.includes('restroom') },
  { k: 'access', label: '♿ Accessible entrance', match: (b) => b.amenities?.includes('accessible-entrance'), profile: 'accessible' },
  { k: 'parking', label: '🅿️ Parking', parking: true },
];
function renderQuick() {
  $('#quick').innerHTML = QUICK.map((q) => `<button data-k="${q.k}">${q.label}</button>`).join('');
  $('#quick').onclick = (e) => { const k = e.target.closest('button')?.dataset.k; if (k) findNearest(QUICK.find((q) => q.k === k)); };
}
function findNearest(q) {
  const origin = S.me ? { type: 'me' } : S.selected ? { type: 'building', id: S.selected } : null;
  const originLabel = S.me ? 'you' : S.selected ? byId.get(S.selected).name : null;
  const out = $('#nearestOut');
  if (!origin) {
    out.innerHTML = '<p class="hint">Turn on location (◎) or select a building first, so we know where to search from.</p>';
    locate(); return;
  }
  const cands = q.parking
    ? S.parking.filter((p) => !S.permit || p.permits.includes(S.permit)).map((p) => ({ place: { type: 'parking', id: p.id }, name: p.name, id: 'P' }))
    : S.buildings.filter(q.match).filter((b) => b.id !== S.selected).map((b) => ({ place: { type: 'building', id: b.id }, name: b.name, id: tag(b), st: openStatus(b.hours) }))
      .filter((c) => !q.openOnly || c.st.open !== false);
  const ranked = cands.map((c) => ({ ...c, r: computeRoute(origin, c.place, q.profile ?? 'standard') })).filter((c) => c.r?.res)
    .sort((a, b) => a.r.minutes - b.r.minutes).slice(0, 4);
  out.innerHTML = `<h2 class="h">${q.label.replace(/^\S+\s/, '')} near ${esc(originLabel)}</h2>` + (ranked.length
    ? `<ul class="list">${ranked.map((c) => `<li><span class="code">${esc(c.id)}</span><button class="link" data-go='${esc(JSON.stringify(c.place))}'>${esc(c.name)}
        ${c.st?.label ? `<div class="sub ${c.st.open ? 'status open' : 'status closed'}" style="margin:0">${esc(c.st.label)}</div>` : ''}</button>
        <span class="muted">${formatMinutes(c.r.minutes)}</span></li>`).join('')}</ul>`
    : '<p class="hint">Nothing matches right now.</p>');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-b]'); if (b) { selectBuilding(b.dataset.b); return; }
  const go = e.target.closest('[data-go]');
  if (go) {
    const origin = S.me ? { type: 'me' } : S.selected ? { type: 'building', id: S.selected } : null;
    setPlace('from', origin); setPlace('to', JSON.parse(go.dataset.go)); showTab('directions'); return;
  }
  const rt = e.target.closest('[data-route-to],[data-route-from]');
  if (rt) {
    const [type, ...rest] = (rt.dataset.routeTo ?? rt.dataset.routeFrom).split(':');
    const v = rest.join(':');
    const place = type === 'pt' ? (([lat, lng]) => ({ type: 'point', lat: +lat, lng: +lng, label: rt.dataset.label ?? 'dropped pin' }))(v.split(',')) : { type, id: v };
    setPlace(rt.dataset.routeTo ? 'to' : 'from', place);
    map.closePopup(); showTab('directions');
  }
});

// ---------------------------------------------------------------- directions
function placeLabel(p) {
  if (!p) return '';
  if (p.type === 'me') return '📍 My location';
  if (p.type === 'building') return byId.get(p.id)?.name ?? p.id;
  if (p.type === 'parking') return parkingById.get(p.id)?.name ?? p.id;
  return p.label ?? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}
function setPlace(which, place) {
  S[which] = place;
  $('#' + which).value = placeLabel(place);
  if (place?.type === 'me' && !S.me) locate();
  updateRoute();
}
attachTypeahead($('#from'), $('#from').nextElementSibling, (it) => setPlace('from', it), { allowMe: true });
attachTypeahead($('#to'), $('#to').nextElementSibling, (it) => setPlace('to', it), { allowMe: true });
$('#swapBtn').onclick = () => { const f = S.from; S.from = S.to; S.to = f; $('#from').value = placeLabel(S.from); $('#to').value = placeLabel(S.to); updateRoute(); };

const ROUTE_COLORS = { fastest: '#2563eb', alternate: '#0d9488', stepfree: '#7c3aed', lit: '#1e3a8a' };
const LEGACY_MODE = { standard: 'fastest', accessible: 'stepfree', night: 'lit' };

/** Which option to pick first: the student's preference, best-lit after dark if they asked for that. */
function preferredKind() {
  if (stepFreeToday()) return 'stepfree';
  const pref = S.settings.preferredRoute ?? 'fastest';
  if (pref !== 'stepfree' && (S.settings.autoNight ?? true) && isDarkOutside()) return 'lit';
  return pref;
}
function stepFreeToday() { try { return sessionStorage.getItem('tigerpath.stepFreeDay') === dayKey(); } catch { return false; } }
const optionFor = (kind) => S.options?.find((o) => o.kind === kind || o.also.includes(kind));

function drawRoutes() {
  layers.route.clearLayers();
  const sel = S.options?.find((o) => o.kind === S.routeKind);
  if (!sel) return;
  for (const o of S.options) if (o !== sel) { // other choices: grey, tap to pick
    const line = L.polyline(o.r.latlngs, { color: '#94a3b8', weight: 6, opacity: 0.85 })
      .bindTooltip(`${o.icon} ${o.label} · ${formatMinutes(o.minutes)}`, { sticky: true }).on('click', () => selectRoute(o.kind)).addTo(layers.route);
    line.bringToBack();
  }
  const r = sel.r;
  L.polyline(r.latlngs, { color: '#fff', weight: 10, opacity: 0.9 }).addTo(layers.route);
  L.polyline(r.latlngs, { color: ROUTE_COLORS[sel.kind], weight: 6 }).addTo(layers.route);
  r.res.edges.forEach((e, i) => { if (e.stairs) L.polyline([r.latlngs[i], r.latlngs[i + 1]], { color: '#dc2626', weight: 6, dashArray: '4 6' }).bindTooltip('Stairs').addTo(layers.route); });
  L.circleMarker(r.latlngs[0], { radius: 8, color: '#111', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Start: ' + r.a.label).addTo(layers.route);
  L.marker(r.latlngs.at(-1), { icon: L.divIcon({ className: '', html: '<div class="numark">★</div>', iconSize: [28, 28] }), interactive: false }).addTo(layers.route);
}
function selectRoute(kind) {
  const o = optionFor(kind); if (!o) return;
  S.routeKind = o.kind; S.lastRoute = o.r;
  if (o.kind === 'stepfree' && !S.layers.access) { S.layers.access = true; applyLayers(); renderLayersTab(); }
  renderRouteOut(); drawRoutes(); writeHash();
}

function updateRoute({ fit = true, keepChoice = false } = {}) {
  const out = $('#routeOut');
  writeHash();
  if (!S.from || !S.to) { S.lastRoute = null; S.options = null; layers.route.clearLayers(); out.innerHTML = '<p class="hint">Choose where you’re starting and where you’re going. Tip: right-click or long-press the map to drop a pin.</p>'; return; }
  if (S.from.type === 'me' && !S.me) { out.innerHTML = '<p class="hint">Waiting for your location…</p>'; return; }
  const fastest = computeRoute(S.from, S.to, 'standard');
  if (fastest?.far) { S.options = null; layers.route.clearLayers(); out.innerHTML = '<p class="hint">Walking directions cover the Towson campus and the streets right around it. That spot is too far from campus paths. Try a closer starting point.</p>'; return; }
  const accessibleDoor = S.to.type === 'building' && accessEntrances(S.to.id).length > 0;
  S.options = routeOptions((profile, extra) => (profile === 'standard' && !extra ? fastest : computeRoute(S.from, S.to, profile, extra)),
    { alwaysStepFree: accessibleDoor || preferredKind() === 'stepfree' || S.requestedKind === 'stepfree' });
  if (!S.options.length) { S.lastRoute = null; layers.route.clearLayers(); out.innerHTML = '<p class="hint">No route found. If “Always avoid stairs” is on, there may be no step-free way — try turning it off in My account.</p>'; return; }
  const want = keepChoice && optionFor(S.routeKind) ? S.routeKind : (S.requestedKind ?? preferredKind());
  S.wantStepFree = want === 'stepfree';
  S.requestedKind = null;
  const sel = optionFor(want) ?? S.options[0];
  S.routeKind = sel.kind; S.lastRoute = sel.r;
  drawRoutes();
  if (fit) {
    const bounds = L.latLngBounds(S.options.flatMap((o) => o.r.latlngs));
    if (isMobile() && $('#panel').dataset.sheet === 'full') { sheet('half'); setTimeout(() => fitView(bounds), 300); } // after the panel slides down
    else fitView(bounds);
  }
  renderRouteOut();
}

function renderRouteOut() {
  const out = $('#routeOut');
  const sel = S.options.find((o) => o.kind === S.routeKind), r = sel.r;
  const arrive = new Date(Date.now() + r.minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const stepfree = S.options.find((o) => !o.stairs);
  out.innerHTML = `
    <div class="route-opts" role="radiogroup" aria-label="Route options">
      ${S.options.map((o) => `<button class="ropt" role="radio" aria-checked="${o === sel}" data-k="${o.kind}" style="--rc:${ROUTE_COLORS[o.kind]}">
        <span class="ropt-top"><b>${formatMinutes(o.minutes)}</b><span class="ropt-name">${o.icon} ${esc(o.label)}</span></span>
        <span class="ropt-meta">${formatDistance(o.r.res.dist, S.units)} · ${o.stairs ? `${o.stairs} stair segment${o.stairs > 1 ? 's' : ''}` : 'no stairs'}${o.via ? ` · via ${esc(o.via)}` : ''}</span>
        ${o.badges.length ? `<span class="ropt-badges">${o.badges.map((b) => `<span class="rbadge${b === 'Quickest' ? ' q' : ''}">${esc(b)}</span>`).join('')}</span>` : ''}
      </button>`).join('')}
    </div>
    ${S.options.length === 1 ? '<p class="hint">This is the only sensible way here — the other route types follow the same path.</p>' : ''}
    <div class="summary"><span class="big">${formatMinutes(r.minutes)}</span><span class="muted">${formatDistance(r.res.dist, S.units)} · arrive ${arrive}</span></div>
    ${sel.stairs && stepfree ? `<p class="hint">⚠️ Includes stairs (red dashes). The ${esc(stepfree.label.toLowerCase())} option avoids them.</p>` : ''}
    ${S.wantStepFree && !optionFor('stepfree') ? `<p class="hint">♿ No step-free route found${S.to?.type === 'building' ? ` to ${esc(byId.get(S.to.id)?.name)}` : ''}. ${S.tu ? 'TU’s accessibility survey lists no accessible entrance or step-free path there. ' : ''}Accessibility &amp; Disability Services can help: <a href="tel:+14107042638">410-704-2638</a>.</p>` : ''}
    <div class="btn-row"><button class="btn primary" id="liveBtn">${S.live ? '■ End' : '▶ Start'}</button><button class="btn" id="wwmBtn">🛡️ Walk With Me</button><button class="btn" id="shareRoute">Share</button><button class="btn" id="printRoute">Print</button></div>
    <ol class="steps">${r.steps.map((s, i) => `<li data-step="${i}"><span class="ico">${s.type === 'arrive' ? '★' : s.type === 'depart' ? '●' : /left/.test(s.text) ? '↰' : /right/.test(s.text) ? '↱' : '↑'}</span>
      <span>${esc(s.text)}</span><span class="d">${s.dist ? formatDistance(s.dist, S.units) : ''}</span></li>`).join('')}</ol>
    ${S.graphSource === 'seed' ? '<p class="hint">Routes use an approximate campus path network. Follow posted signs and sidewalks.</p>' : `<p class="hint">Walkway data © OpenStreetMap contributors.${S.tu && sel.kind === 'stepfree' ? ' Accessibility data: Towson University campus map (preliminary).' : ''}</p>`}`;
  out.querySelector('.route-opts').onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) selectRoute(k); };
  $('#routeOut .steps').onclick = (e) => { const li = e.target.closest('[data-step]'); if (li) { const s = r.steps[+li.dataset.step]; flyTo([s.at.lat, s.at.lng], 19); } };
  $('#shareRoute').onclick = () => share(shareUrl(), `Walk to ${r.b.label}`);
  $('#printRoute').onclick = () => window.print();
  $('#liveBtn').onclick = toggleLive;
  $('#wwmBtn').onclick = () => wwm?.open();
}

// ---------------------------------------------------------------- turn-by-turn navigation
// Like a car GPS, for walking: follows your position along the route, shows the next
// turn and the distance to it, speaks prompts, reroutes when you leave the route,
// and tells you when you've arrived. ?demo (or ?simulate) walks the route for you.
const SIMULATE = DEMO || new URLSearchParams(location.search).has('simulate');
let nav = null, navLayer = null, navFollow = true, navStep = -1, lastReroute = 0, simTimer = null;
let navVoice = store.get('navVoice', true);
const TURN_DEG = { straight: 0, 'slight-right': 45, right: 90, 'sharp-right': 135, 'slight-left': -45, left: -90, 'sharp-left': -135 };
function turnSvg(kind) {
  if (kind === 'arrive') return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 44V6M14 8h22l-5 7 5 7H14" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  const a = (TURN_DEG[kind] ?? 0) * Math.PI / 180;
  const ex = 24 + 15 * Math.sin(a), ey = 22 - 15 * Math.cos(a);
  const h = (d) => `${ex + 8 * Math.sin(a + d)},${ey - 8 * Math.cos(a + d)}`; // arrowhead wings
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 46V22L${ex},${ey}" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M${h(Math.PI * 0.8)}L${ex},${ey}L${h(-Math.PI * 0.8)}" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
document.body.insertAdjacentHTML('beforeend', `
  <div id="navHud" role="region" aria-label="Next turn" hidden>
    <div class="nav-top"><div class="nav-icon" id="navIcon"></div>
      <div class="nav-main"><div class="nav-dist" id="navDist"></div><div class="nav-text" id="navText"></div></div></div>
    <div class="nav-then" id="navThen" hidden></div>
  </div>
  <p class="sr-only" id="navSay" aria-live="assertive"></p>
  <div id="navBottom" role="region" aria-label="Trip progress" hidden>
    <div class="nav-sum"><b id="navEta"></b><span id="navLeft"></span></div>
    <div class="nav-btns">
      <button class="fab" id="navRecenter" hidden aria-label="Re-center on my position">◎</button>
      <button class="fab" id="navVoiceBtn"></button>
      <button class="btn small" id="navOverview">Overview</button>
      <button class="btn small danger" id="navEnd">End</button>
    </div>
  </div>`);
function renderVoiceBtn() { const b = $('#navVoiceBtn'); b.textContent = navVoice ? '🔊' : '🔇'; b.setAttribute('aria-label', navVoice ? 'Voice guidance on' : 'Voice guidance off'); b.setAttribute('aria-pressed', String(navVoice)); }
renderVoiceBtn();
$('#navVoiceBtn').onclick = () => { navVoice = !navVoice; store.set('navVoice', navVoice); renderVoiceBtn(); if (!navVoice) window.speechSynthesis?.cancel(); };
$('#navEnd').onclick = () => endNav();
$('#navRecenter').onclick = () => { navFollow = true; $('#navRecenter').hidden = true; if (S.me) map.setView([S.me.lat, S.me.lng], Math.max(map.getZoom(), 18)); };
$('#navOverview').onclick = () => { navFollow = false; $('#navRecenter').hidden = false; fitView(L.latLngBounds(nav ? nav.pts.map((p) => [p.lat, p.lng]) : [])); };
map.on('dragstart', () => { if (S.live) { navFollow = false; $('#navRecenter').hidden = false; } });

function say(text) {
  $('#navSay').textContent = text; // screen readers hear every prompt, voice on or off
  if (!navVoice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.02;
  speechSynthesis.speak(u);
}

function toggleLive() { if (S.live) endNav(); else startNav(); }
function startNav() {
  if (!S.to) { toast('Choose a destination first'); return; }
  if (SIMULATE) { // presentations: walk the route on screen from wherever it starts
    if (!S.lastRoute) return;
    beginNav(); startSimulation(); return;
  }
  if (!S.me) { toast('Finding your location…'); S.navPending = true; startWatch(); return; }
  if (S.from?.type !== 'me') setPlace('from', { type: 'me' }); // navigation always starts where you are
  else updateRoute({ fit: false, keepChoice: true });
  if (!S.lastRoute) { toast('Couldn’t find a walking route from where you are.'); return; }
  beginNav();
}
function beginNav() {
  S.live = true; nav = createNav(S.lastRoute); navStep = -1; navFollow = true;
  document.body.classList.add('navigating');
  $('#navHud').hidden = false; $('#navBottom').hidden = false; $('#navRecenter').hidden = true;
  sheet('peek');
  tracker.start('nav').catch(() => {}); // keeps the screen on; walks count toward goals when signed in
  if (isNative && !SIMULATE) startBackgroundLocation({ message: `Navigating to ${S.lastRoute?.b?.label ?? 'your destination'}`, onFix: onPosition }); // keeps going with the phone locked
  renderRouteOut();
  const start = S.me && !SIMULATE ? S.me : nav.pts[0];
  map.setView([start.lat, start.lng], 18, { animate: false });
  if (SIMULATE) S.me = { ...nav.pts[0], acc: 5 };
  onLiveUpdate();
}
function endNav({ arrived = false } = {}) {
  const label = S.lastRoute?.b?.label;
  S.live = false; nav = null; S.navPending = false;
  clearInterval(simTimer); simTimer = null;
  document.body.classList.remove('navigating');
  $('#navHud').hidden = true; $('#navBottom').hidden = true;
  navLayer?.remove(); navLayer = null;
  if (tracker.source === 'nav') tracker.stop();
  stopBackgroundLocation();
  window.speechSynthesis?.cancel();
  if (arrived) { toast(`You’ve arrived at ${label ?? 'your destination'} 🎉`, 5000); say(`You have arrived at ${label ?? 'your destination'}`); }
  sheet('half');
  updateRoute({ fit: !arrived, keepChoice: true });
}
/** Walk the route at about 4× walking speed (demo mode and ?simulate). */
function startSimulation() {
  clearInterval(simTimer);
  let along = 0;
  simTimer = setInterval(() => {
    if (!nav) { clearInterval(simTimer); return; }
    along += S.pace * 4;
    let i = 1; while (i < nav.cum.length - 1 && nav.cum[i] < along) i++;
    const a = nav.pts[i - 1], b = nav.pts[i], seg = nav.cum[i] - nav.cum[i - 1] || 1, t = Math.min(1, (along - nav.cum[i - 1]) / seg);
    S.me = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), acc: 5 };
    placeMe(S.me);
    onLiveUpdate();
  }, 1000);
}

function onLiveUpdate() {
  if (S.navPending && S.me) { S.navPending = false; startNav(); return; }
  if (!S.live || !nav || !S.me) return;
  const u = navUpdate(nav, S.me, { speak: (m) => spokenDistance(m, S.units) });
  if (u.arrived) { endNav({ arrived: true }); return; }
  if (u.offRoute && !SIMULATE && Date.now() - lastReroute > 6000) { // left the route: find a new one from here
    lastReroute = Date.now();
    say('Rerouting'); toast('Off route — finding a new way');
    updateRoute({ fit: false, keepChoice: true });
    if (S.lastRoute) { nav = createNav(S.lastRoute); nav.spoken.add('start'); navStep = -1; }
    return onLiveUpdate();
  }
  // walker's dot: snapped onto the path when close, with an arrow showing the direction of travel
  placeMe(u.snapped, S.me.heading ?? u.heading);
  // route: walked part grey, the rest in the route's color
  const { done, ahead } = splitRoute(nav, u.snapped);
  layers.route.clearLayers();
  navLayer = L.layerGroup([
    L.polyline(done, { color: '#94a3b8', weight: 6, opacity: 0.8 }),
    L.polyline(ahead, { color: '#fff', weight: 11, opacity: 0.9 }),
    L.polyline(ahead, { color: ROUTE_COLORS[S.routeKind] ?? '#2563eb', weight: 7 }),
    L.marker(nav.pts.at(-1), { icon: L.divIcon({ className: '', html: '<div class="numark">★</div>', iconSize: [28, 28] }), interactive: false }),
  ]).addTo(layers.route);
  if (navFollow) { // keep the walker in the lower part of the screen, so more of the way ahead shows
    const h = map.getSize().y, lift = isMobile() ? h * 0.2 : h * 0.12;
    map.panTo(map.unproject(map.project([u.snapped.lat, u.snapped.lng]).subtract([0, lift])), { animate: true, duration: 0.5 });
  }
  // banner
  const kind = turnIcon(u.next);
  $('#navIcon').innerHTML = turnSvg(kind);
  $('#navDist').textContent = u.next.type === 'arrive' && u.toNext < 15 ? 'Arriving' : formatDistance(u.toNext, S.units);
  $('#navText').textContent = u.next.type === 'arrive' ? shortText(u.next) : shortText(u.next);
  const then = u.then && u.toNext < 120 ? u.then : null;
  $('#navThen').hidden = !then;
  if (then) $('#navThen').innerHTML = `Then <span class="nav-mini">${turnSvg(turnIcon(then))}</span> ${esc(shortText(then))}`;
  $('#navHud').classList.toggle('soon', u.toNext < 30 && u.next.type !== 'arrive');
  $('#navHud').classList.toggle('off', u.offBy > 25);
  // bottom: time, distance and arrival time left
  const min = u.remaining / S.pace / 60;
  const arrive = new Date(Date.now() + min * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#navEta').textContent = formatMinutes(min);
  $('#navLeft').textContent = ` · ${formatDistance(u.remaining, S.units)} · arrive ${arrive}`;
  // highlight the current step in the list
  if (u.next.n !== navStep) {
    navStep = u.next.n;
    document.querySelectorAll('#routeOut .steps li').forEach((li) => li.classList.toggle('cur', +li.dataset.step === navStep));
  }
  if (u.say) { say(u.say); if (/^(Turn|Make|Bear)/.test(u.say)) tap(); }
}
function placeMe(p, heading = null) {
  if (!meMarker) {
    meMarker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"><i class="me-cone"></i></div>', iconSize: [18, 18] }), interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(layers.me);
    meCircle = L.circle([p.lat, p.lng], { radius: S.me?.acc ?? 10, weight: 1, color: '#2563eb', fillOpacity: 0.08, interactive: false }).addTo(layers.me);
  } else { meMarker.setLatLng([p.lat, p.lng]); meCircle.setLatLng([p.lat, p.lng]).setRadius(S.me?.acc ?? 10); }
  const cone = meMarker.getElement()?.querySelector('.me-cone');
  if (cone) { cone.style.display = heading == null || !S.live ? 'none' : 'block'; if (heading != null) cone.style.transform = `rotate(${heading}deg)`; }
}

// ---------------------------------------------------------------- location
let meMarker, meCircle;
function startWatch() {
  if (S.watchId != null || !navigator.geolocation) return;
  S.watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
    // Permission denied stops for good. Timeouts and "position unavailable" are usually a passing GPS
    // hiccup (under trees, near buildings): the browser keeps watching, so navigation carries on.
    if (err.code === 1) { toast('Location permission denied — turn on location for TigerPath in your settings.', 5000); navigator.geolocation.clearWatch(S.watchId); S.watchId = null; if (S.live && !simTimer) endNav(); }
    else if (!S.me) toast('Still looking for your location…');
  }, { enableHighAccuracy: true, maximumAge: 1000 });
}
/** One GPS fix, from the browser's watcher or (iPhone app) the background-location watcher. */
let lastFix = null;
function onPosition(pos) {
  if (simTimer) return; // a simulated walk is driving the position
  const c = pos.coords;
  const key = `${c.latitude.toFixed(6)},${c.longitude.toFixed(6)},${pos.timestamp}`;
  if (key === lastFix) return; // the same fix delivered by both watchers
  lastFix = key;
  const first = !S.me;
  const moving = c.speed == null || c.speed > 0.4;
  S.me = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, heading: moving && Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null };
  detectVisit(S.me);
  wwm?.position(S.me);
  tour?.position(S.me);
  placeMe(S.me);
  $('#locateBtn').classList.add('active');
  if (first) {
    const far = distance(S.me, { lat: CENTER[0], lng: CENTER[1] }) > 3000;
    if (far) toast('You appear to be off campus — routes start from the nearest campus path.', 4000);
    else flyTo([S.me.lat, S.me.lng], 18);
    if ((S.from?.type === 'me' || S.to?.type === 'me') && !S.navPending) updateRoute();
  }
  onLiveUpdate();
}
function locate() { if (S.me) flyTo([S.me.lat, S.me.lng], 18); startWatch(); }
$('#locateBtn').onclick = locate;
$('#resetBtn').onclick = () => { if (map.getSize().x) map.flyTo(CENTER, 16); };

// right-click / long-press on map
map.on('contextmenu', (e) => {
  const { lat, lng } = e.latlng;
  const nb = S.buildings.map((b) => ({ b, d: distance(b, { lat, lng }) })).sort((a, c) => a.d - c.d)[0];
  L.popup().setLatLng(e.latlng).setContent(`<div class="ctx-menu">
    <button data-route-from="pt:${lat},${lng}">🟢 Directions from here</button>
    <button data-route-to="pt:${lat},${lng}">🏁 Directions to here</button>
    ${nb && nb.d < 120 ? `<button data-b="${esc(nb.b.id)}">ℹ️ ${esc(nb.b.name)}</button>` : ''}</div>`).openOn(map);
});

// ---------------------------------------------------------------- schedule
function renderSchedule() {
  renderSeg('#dayPicker', WEEKDAYS.map((d) => [d, DAY_LABELS[d]]), S.day, (d) => { S.day = d; renderSchedule(); writeHash(); });
  const plan = planDay(S.schedule, S.day, walkMinutes);
  const el = $('#dayPlan');
  if (!S.schedule.length) {
    el.innerHTML = `<p class="hint">Add your classes to see your day on the map, how long each walk takes, and which transitions are too tight.</p>`;
    layers.route.clearLayers(); $('#addClass').open = true; return;
  }
  if (!plan.classes.length) { el.innerHTML = `<p class="hint">No classes on ${DAY_LABELS[S.day]}. 🎉</p>`; layers.route.clearLayers(); return; }
  const w = (l) => formatMinutes(Math.ceil(l.walk)); // round walks up so “10 min walk, 10 min gap” never says late
  const LEG_TEXT = { ok: (l) => `🚶 ${w(l)} walk · ${l.gap} min between`, tight: (l) => `⚠️ ${w(l)} walk, only ${l.gap} min between — hustle`,
    late: (l) => `⛔ ${w(l)} walk but only ${l.gap} min between — you’ll be late`, overlap: () => '⛔ These classes overlap' };
  el.innerHTML = plan.classes.map((c, i) => {
    const b = byId.get(c.building);
    const leg = plan.legs[i];
    return `<div class="class-item"><span class="num">${i + 1}</span><div class="meta"><b>${esc(c.title)}</b>
        <span class="sub">${formatTime(c.start)}–${formatTime(c.end)} · <a href="#" data-b="${esc(c.building)}" data-room="${esc(c.room ?? '')}">${esc(b?.name ?? c.building)}${c.room ? ' ' + esc(c.room) : ''}</a></span></div>
        <button class="icon-btn" data-edit="${esc(c.id)}" aria-label="Edit ${esc(c.title)}">✎</button>
        <button class="icon-btn" data-del="${esc(c.id)}" aria-label="Remove ${esc(c.title)}">✕</button></div>
      ${leg ? `<div class="leg ${leg.status}">${LEG_TEXT[leg.status](leg)}</div>` : ''}`;
  }).join('');
  el.querySelectorAll('[data-edit]').forEach((btn) => btn.onclick = () => editClass(btn.dataset.edit));
  el.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => {
    const at = S.schedule.findIndex((c) => c.id === btn.dataset.del), cls = S.schedule[at];
    if (S.editingClass === cls.id) endClassEdit();
    acc.update((d) => { d.schedule = d.schedule.filter((c) => c.id !== cls.id); });
    renderSchedule();
    toast(`Removed ${cls.title}`, 6000, { label: 'Undo', run: () => { acc.update((d) => { d.schedule.splice(at, 0, cls); }); renderSchedule(); } });
  });
  el.querySelectorAll('[data-room]').forEach((a) => a.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const room = a.dataset.room ? search(index, `${a.dataset.b} ${a.dataset.room}`)[0]?.room : null;
    selectBuilding(a.dataset.b, { room });
  });
  drawDay(plan);
}
/** Fill the class form with a class to change it; saving replaces it in place. */
function editClass(id) {
  const c = S.schedule.find((x) => x.id === id); if (!c) return;
  S.editingClass = id;
  $('#cTitle').value = c.title; $('#cBldg').value = c.building; $('#cRoom').value = c.room ?? '';
  $('#cDays').querySelectorAll('input').forEach((i) => { i.checked = c.days.includes(i.value); });
  $('#cStart').value = c.start; $('#cEnd').value = c.end;
  $('#classFormTitle').textContent = `✎ Edit ${c.title}`; $('#classSubmit').textContent = 'Save changes'; $('#classCancel').hidden = false;
  $('#addClass').open = true;
  $('#addClass').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function endClassEdit() {
  S.editingClass = null;
  $('#classForm').reset(); $('#cStart').value = '09:30'; $('#cEnd').value = '10:45';
  $('#classFormTitle').textContent = '＋ Add a class'; $('#classSubmit').textContent = 'Add class'; $('#classCancel').hidden = true;
}
let lastDayFit = '';
function drawDay(plan) {
  layers.route.clearLayers();
  const all = [];
  plan.legs.forEach((leg) => {
    if (leg.from.building === leg.to.building) return;
    const r = computeRoute({ type: 'building', id: leg.from.building }, { type: 'building', id: leg.to.building }, 'standard');
    if (!r?.res) return;
    const color = leg.status === 'ok' ? '#2563eb' : leg.status === 'tight' ? '#d97706' : '#dc2626';
    L.polyline(r.latlngs, { color: '#fff', weight: 9 }).addTo(layers.route);
    L.polyline(r.latlngs, { color, weight: 5 }).addTo(layers.route);
    all.push(...r.latlngs);
  });
  plan.classes.forEach((c, i) => {
    const b = byId.get(c.building); if (!b) return;
    L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', html: `<div class="numark">${i + 1}</div>`, iconSize: [28, 28] }), zIndexOffset: 1000 })
      .bindTooltip(`${i + 1}. ${c.title} · ${formatTime(c.start)}`).addTo(layers.route);
    all.push([b.lat, b.lng]);
  });
  const key = `${S.day}|${plan.classes.map((c) => `${c.id}@${c.building}`).join(',')}`;
  if (all.length && key !== lastDayFit) fitView(L.latLngBounds(all)); // don't re-fly on every re-render
  lastDayFit = key;
}
function initScheduleForm() {
  $('#cBldg').innerHTML = [...S.buildings].sort((a, b) => a.name.localeCompare(b.name))
    .filter((b) => b.category !== 'landmark').map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(tag(b))})</option>`).join('');
  $('#cDays').innerHTML = WEEKDAYS.map((d) => `<label><input type="checkbox" value="${d}" />${DAY_LABELS[d]}</label>`).join('');
  $('#classForm').onsubmit = (e) => {
    e.preventDefault();
    const days = [...$('#cDays').querySelectorAll('input:checked')].map((i) => i.value);
    if (!days.length) { toast('Pick at least one day'); return; }
    if ($('#cEnd').value <= $('#cStart').value) { toast('End time must be after start time'); return; }
    const editing = S.editingClass;
    const cls = { id: editing ?? crypto.randomUUID?.() ?? String(Date.now()), title: $('#cTitle').value.trim(), building: $('#cBldg').value,
      room: $('#cRoom').value.trim(), days, start: $('#cStart').value, end: $('#cEnd').value };
    acc.update((d) => {
      const at = d.schedule.findIndex((c) => c.id === editing);
      if (at >= 0) d.schedule[at] = cls; else d.schedule.push(cls);
    });
    if (!days.includes(S.day)) S.day = days[0];
    endClassEdit();
    renderSchedule(); toast(editing ? 'Class updated' : 'Class added');
  };
  $('#classCancel').onclick = endClassEdit;
  const y = new Date().getFullYear();
  const syncTerm = () => { $('#termStart').value = S.settings.term?.start ?? `${y}-08-31`; $('#termEnd').value = S.settings.term?.end ?? `${y}-12-11`; };
  syncTerm(); acc.onChange(syncTerm);
  const saveTerm = () => { if ($('#termStart').value && $('#termEnd').value >= $('#termStart').value) acc.update((d) => { d.settings.term = { start: $('#termStart').value, end: $('#termEnd').value }; }); };
  $('#termStart').onchange = saveTerm; $('#termEnd').onchange = saveTerm;
  $('#icsBtn').onclick = () => {
    if (!S.schedule.length) { toast('Add a class first'); return; }
    const termStart = $('#termStart').value, termEnd = $('#termEnd').value;
    if (!termStart || !termEnd || termEnd < termStart) { toast('Check the term dates'); return; }
    saveTerm();
    const ics = toICS(S.schedule, { termStart, termEnd, buildingName: (id) => byId.get(id)?.name ?? id, alarmMinutes: S.settings.leadMinutes ?? 10 });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: 'towson-classes.ics' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// ---------------------------------------------------------------- layers tab
function renderLayersTab() {
  const rows = [
    ['buildings', 'Buildings', '#2563eb'], ['labels', 'Building names', '#64748b'], ['outlines', 'Building footprints (OSM)', '#94a3b8'],
    ['parking', 'Parking', '#475569'], ['shuttle', 'Shuttle routes', '#ffbb00'], ['safety', 'Emergency phones & AEDs', '#1d4ed8'],
    ['access', '♿ Accessible routes, curb cuts & parking', '#7c3aed'],
  ];
  $('#layerToggles').innerHTML = rows.map(([k, label, c]) => `<label><input type="checkbox" data-l="${k}" ${S.layers[k] ? 'checked' : ''}/><span class="swatch" style="background:${c}"></span>${label}</label>`).join('');
  $('#layerToggles').onchange = (e) => { S.layers[e.target.dataset.l] = e.target.checked; applyLayers(); renderAccessLegend(); };
  renderAccessLegend();
  $('#permit').innerHTML = '<option value="">All permits</option>' + Object.entries(PERMIT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#permit').onchange = (e) => { S.permit = e.target.value; drawParking(); };
  $('#shuttleNote').innerHTML = S.tu
    ? `Shuttle lines and stops from TU’s campus map: ${S.shuttles.map((r) => `<span class="lg-inline" style="background:${r.color}"></span>${esc(r.name)}`).join(', ')}. <a href="${LIVE_SHUTTLE_URL}" target="_blank" rel="noopener">Schedules &amp; live arrivals ↗</a>`
    : `Shuttle lines shown are a sample. <a href="${LIVE_SHUTTLE_URL}" target="_blank" rel="noopener">Official shuttle info ↗</a>`;
  const phones = safety.length;
  $('#dataNote').innerHTML = (S.graphSource === 'osm'
    ? `Walkways from OpenStreetMap (${new Date(S.osm.generated).toLocaleDateString()}): ${S.osm.edges.length.toLocaleString()} path segments.`
    : 'Routing uses an approximate path network between buildings. Run <code>npm run fetch-osm</code> to load real walkways.')
    + (phones ? ` ${phones} emergency phones/AEDs loaded.` : ' No verified emergency phone data loaded yet.')
    + (S.graphSource === 'osm' ? ' Building locations from OpenStreetMap footprints.' : ' Building positions are approximate until verified.')
    + (S.tu ? ` Accessibility, shuttle, parking and office data from <a href="https://maps.towson.edu/" target="_blank" rel="noopener">TU’s official campus map</a> (${new Date(S.tu.fetched + 'T12:00').toLocaleDateString()}; TU marks it preliminary).` : '');
}

function renderAccessLegend() {
  const el = $('#accessLegend'); if (!el) return;
  el.hidden = !S.layers.access;
  if (S.tu) {
    const spaces = S.tu.accessParking.reduce((n, p) => n + (p.spaces ?? 0), 0);
    el.innerHTML = `<ul class="legend">
      <li><span class="lg" style="background:#5b21b6;height:5px"></span>Accessible route</li>
      <li><span class="lg dash" style="color:#a16207"></span>Limited accessibility</li>
      <li><span class="lg dash" style="color:#dc2626"></span>Not accessible — avoid</li>
      <li><span class="lg dot" style="background:#dc2626"></span>Stairs</li>
      <li><span class="amark sm" aria-hidden="true">♿</span>Accessible entrance (automatic door)</li>
      <li><span class="amark sm para" aria-hidden="true">🚐</span>Paratransit stop</li></ul>
    <p class="hint">${S.tu.entrances.length} accessible entrances, ${spaces} accessible parking spaces and ${S.tu.paratransit.length} paratransit stops, from TU’s official campus map survey.
      Step-free directions use TU’s route ratings and go to a building’s accessible entrance.</p>`;
    return;
  }
  el.innerHTML = `<ul class="legend">
      <li><span class="lg" style="background:#5b21b6;height:5px"></span>Marked wheelchair-friendly</li>
      <li><span class="lg" style="background:#7c3aed;opacity:.6"></span>Step-free path</li>
      <li><span class="lg dash" style="color:#a16207"></span>Rough surface (gravel, grass)</li>
      <li><span class="lg dash" style="color:#dc2626"></span>Stairs or curb — avoid</li>
      <li><span class="lg dot"></span>Curb cut</li></ul>
    <p class="hint">${(S.osm?.access?.curbCuts?.length ?? 0)} curb cuts, ${(S.osm?.access?.parking ?? []).reduce((n, p) => n + p.capacity, 0)} accessible parking spaces and ${accessFeatures().length} ramps/elevators/entrances mapped so far.
      Ramps, elevators and accessible entrances are still missing from the map data — see TU's <a href="${OFFICIAL_ACCESS_MAP_URL}" target="_blank" rel="noopener">official accessibility map (PDF) ↗</a>.</p>`;
}

// ---------------------------------------------------------------- theme
/** theme: 'system' | 'light' | 'dark' (a My account preference) */
function applyTheme(theme = S.settings.theme ?? store.get('theme', null) ?? 'system') {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  if (S.basemap === 'map' && selfHosted) setBasemap('map'); // switch light/dark map style
}

// ---------------------------------------------------------------- URL state
function encPlace(p) { return !p ? '' : p.type === 'me' ? 'me' : p.type === 'building' ? p.id : p.type === 'parking' ? 'park:' + p.id : `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`; }
function decPlace(s) {
  if (!s) return null;
  if (s === 'me') return { type: 'me' };
  if (s.startsWith('park:')) return { type: 'parking', id: s.slice(5) };
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(s)) { const [lat, lng] = s.split(',').map(Number); return { type: 'point', lat, lng, label: 'shared pin' }; }
  return byId.has(s) ? { type: 'building', id: s } : null;
}
let applyingHash = false;
function writeHash() {
  if (applyingHash) return;
  const p = new URLSearchParams();
  if (S.tab === 'directions') { if (S.from) p.set('from', encPlace(S.from)); if (S.to) p.set('to', encPlace(S.to)); if (S.routeKind && S.routeKind !== preferredKind()) p.set('route', S.routeKind); }
  else if (S.tab === 'schedule') { p.set('tab', 'classes'); p.set('day', S.day); }
  else if (S.tab === 'layers') p.set('tab', 'layers');
  else if (S.tab === 'account') p.set('tab', 'account');
  else if (S.tab === 'activity') p.set('tab', 'activity');
  else if (S.tab === 'tour') p.set('tour', String(tour.index + 1));
  else if (S.selected) { p.set('b', S.selected); if (S.room) p.set('room', S.room.room); }
  const h = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
}
function readHash() {
  applyingHash = true;
  const p = new URLSearchParams(location.hash.slice(1));
  try {
    const watch = parseWatch(p);
    if (watch) { startWatching(watch); showTab('explore'); return; }
    if (p.has('tour')) { const n = Math.max(1, +p.get('tour') || 1); showTab('tour'); tour.start(Math.min(n, tour.stops.length) - 1); return; }
    if (p.has('from') || p.has('to')) {
      const k = p.get('route') ?? LEGACY_MODE[p.get('mode')];
      if (k) S.requestedKind = k;
      S.from = decPlace(p.get('from')); S.to = decPlace(p.get('to'));
      $('#from').value = placeLabel(S.from); $('#to').value = placeLabel(S.to);
      if (S.from?.type === 'me' || S.to?.type === 'me') startWatch();
      showTab('directions'); updateRoute();
    } else if (p.get('tab') === 'classes') {
      if (WEEKDAYS.includes(p.get('day'))) S.day = p.get('day');
      showTab('schedule');
    } else if (p.get('tab') === 'layers') showTab('layers');
    else if (p.get('tab') === 'account' || p.get('tab') === 'me') showTab('account');
    else if (p.get('tab') === 'activity') showTab('activity');
    else if (p.has('b') && byId.has(p.get('b'))) {
      const room = p.get('room') ? search(index, `${p.get('b')} ${p.get('room')}`)[0]?.room : null;
      selectBuilding(p.get('b'), { room });
    } else showTab('explore');
  } finally { applyingHash = false; }
}

// ---------------------------------------------------------------- search box (explore)
attachTypeahead($('#q'), $('#qResults'), (it) => {
  if (it.type === 'me') { locate(); return; }
  $('#q').value = ''; $('#q').blur(); // the keyboard would cover the card
  if (it.type === 'parking') { showParking(it.id); return; }
  selectBuilding(it.id, { room: it.room ?? null });
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); showTab('explore'); $('#q').focus(); }
});

// ---------------------------------------------------------------- boot
async function loadOsm() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/osm-campus.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
    const data = await res.json();
    S.osm = data;
    const matches = matchBuildings(S.buildings, data.buildings);
    const overrides = store.get('pins', {});
    for (const [id, o] of matches) {
      o.ourId = id;
      outlines.set(id, o.outline);
      if (!overrides[id]) { const b = byId.get(id); b.lat = o.lat; b.lng = o.lng; } // real footprint beats seed pin
    }
    safety.push(...data.safety);
  } catch { /* no OSM data bundled — seed data is used */ }
}

/** TU's own campus map data (scripts/fetch-tu.mjs): accessibility, shuttles, parking, offices. */
async function loadTu() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/tu-campus.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return;
    S.tu = await res.json();
  } catch { return; } // not bundled — TigerPath's own sample data is used
  for (const x of mergeBuildings(S.buildings, S.tu)) { S.buildings.push(x); byId.set(x.id, x); }
  if (S.tu.parking?.length) {
    S.parking = S.tu.parking;
    parkingById.clear();
    for (const p of S.parking) parkingById.set(p.id, p);
    for (const [old, now] of Object.entries(LEGACY_PARKING)) if (parkingById.has(now)) parkingById.set(old, parkingById.get(now));
  }
  index = buildIndex();
  if (S.tu.shuttles?.length) S.shuttles = S.tu.shuttles;
  map.attributionControl.addAttribution('Campus data: <a href="https://maps.towson.edu/">Towson University</a>');
}

// ---------------------------------------------------------------- iPhone step counter (app only)
/**
 * Fill in daily steps and distance from the iPhone's step counter (last 7 days).
 * Takes the larger of the phone's count and what TigerPath tracked, so nothing counts twice.
 */
async function syncPhoneSteps() {
  if (!isNative || !acc.user || S.settings.phoneSteps === false) return;
  S.phoneSteps = await stepPermission();
  if (S.phoneSteps !== 'granted') { if (S.tab === 'activity') meView?.render(); return; }
  const hist = await stepHistory(7, dayKey);
  const changes = Object.entries(hist).filter(([k, v]) => { const cur = acc.data.activity[k]; return !cur || v.steps > cur.steps || v.meters > cur.meters; });
  if (!changes.length) return;
  acc.update((d) => {
    for (const [k, v] of changes) {
      const cur = d.activity[k] ?? { meters: 0, campusMeters: 0, steps: 0, seconds: 0 };
      d.activity[k] = { ...cur, steps: Math.max(cur.steps, v.steps), meters: Math.max(cur.meters, v.meters), phone: true };
    }
  });
  syncHallCup({ now: true });
}

// ---------------------------------------------------------------- accounts, activity, reminders
let meView, tracker, reminders, wwm;
const tour = createTour({
  map, el: $('#tourOut'), byId, layer: layers.tour, toast,
  computeRoute: (a, b, profile) => computeRoute(a, b, profile),
  fitView: (bounds) => fitView(bounds),
  units: () => S.units,
  startLocation: () => startWatch(),
  directionsTo: (id) => { setPlace('from', S.me ? { type: 'me' } : null); setPlace('to', { type: 'building', id }); showTab('directions'); },
  onExit: () => showTab('explore'),
});

// ---------------------------------------------------------------- Campus Pulse
function nextClassWalk(cls) {
  const b = byId.get(cls.building); if (!b) return null;
  if (S.me) { // from where you are, if you're on campus
    const r = computeRoute({ type: 'me' }, { type: 'building', id: b.id }, 'standard');
    if (r?.res) return { minutes: r.minutes, fromLabel: 'your location', from: { type: 'me' } };
  }
  const today = DAYS[new Date().getDay()];
  const prev = S.schedule.filter((c) => c.id !== cls.id && c.days.includes(today) && c.end <= cls.start).sort((a, c) => c.end.localeCompare(a.end))[0];
  const origin = prev?.building ?? S.settings.home;
  if (!origin || origin === cls.building || !byId.has(origin)) return null;
  const m = walkMinutes(origin, cls.building);
  return m == null ? null : { minutes: m, fromLabel: byId.get(origin).name, from: { type: 'building', id: origin } };
}
function renderPulseNow() {
  const el = $('#pulse'); if (!el || !acc.backend) return;
  renderPulse(el, {
    headEl: $('#greet'), acc, buildings: S.buildings, byId, weather: S.weather, units: S.units, stepFreeToday: stepFreeToday(), nextClassWalk, hallBoard: hallBoard(), lastWinner: S.lastWinner,
    actions: {
      directionsTo: (cls) => { const w = nextClassWalk(cls); setPlace('from', w?.from ?? (S.me ? { type: 'me' } : null)); setPlace('to', { type: 'building', id: cls.building }); showTab('directions'); },
      addClasses: () => { showTab('schedule'); $('#addClass').open = true; },
      signIn: () => meView.showWelcome(),
      tour: () => showTab('tour'),
      walkWithMe: () => { showTab('directions'); if (!S.to) { toast('Choose where you’re walking to, then tap 🛡️ Walk With Me'); $('#to').focus(); } else wwm.open(); },
      stepFreeToday: () => { try { sessionStorage.setItem('tigerpath.stepFreeDay', dayKey()); } catch { /* ignore */ } toast('Step-free routes will be picked first today'); renderPulseNow(); if (S.from && S.to) updateRoute({ fit: false }); },
      openAccount: () => showTab('activity'),
    },
  });
}
async function loadWeather() {
  try { S.weather = await getWeather(); if (!S.selected) renderPulseNow(); } catch { /* offline or blocked: Pulse just skips weather */ }
}

// ---------------------------------------------------------------- visits, badges, challenges
const outlines = new Map(); // building id -> OSM footprint
function insidePoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function detectVisit(p) {
  if (!p || p.acc > 50) return;
  const today = dayKey();
  for (const b of S.buildings) {
    if (acc.data.visits?.[b.id]?.last === today) continue;
    const poly = outlines.get(b.id);
    const here = poly ? insidePoly(p, poly) || distance(p, b) < 20 : distance(p, b) < 35;
    if (!here) continue;
    let first = false;
    acc.update((d) => { first = recordVisit(d, b.id); });
    if (first && acc.user) toast(`📍 New place discovered: ${b.name} (${Object.keys(acc.data.visits).length} of ${S.buildings.length})`, 3500);
  }
}
let achievementsBusy = false;
function checkAchievements() {
  if (!acc.user || achievementsBusy) return;
  achievementsBusy = true;
  try {
    const wk = weekKey();
    const done = challengeProgress(weeklyChallenges(wk, acc.data.goals), weekStats(acc.data)).filter((c) => c.done).map((c) => c.id);
    const logged = acc.data.challengeLog?.[wk] ?? [];
    const newDone = done.filter((id) => !logged.includes(id));
    if (newDone.length) {
      acc.update((d) => { d.challengeLog = { ...d.challengeLog, [wk]: [...logged, ...newDone] }; });
      const titles = weeklyChallenges(wk, acc.data.goals).filter((c) => newDone.includes(c.id)).map((c) => c.title);
      toast(`✅ Challenge complete: ${titles.join(', ')}`, 4000);
    }
    const earned = newBadges(acc.data, S.buildings);
    if (earned.length) {
      acc.update((d) => { d.badges = { ...d.badges, ...Object.fromEntries(earned.map((id) => [id, dayKey()])) }; });
      const b = BADGES.find((x) => x.id === earned.at(-1));
      setTimeout(() => toast(`🏅 Badge unlocked: ${b.title} — ${b.desc}${earned.length > 1 ? ` (+${earned.length - 1} more)` : ''}`, 4500), newDone.length ? 4200 : 0);
    }
  } finally { achievementsBusy = false; }
}

// ---------------------------------------------------------------- Hall Cup
const TEAMS = teamOptions(S.buildings);
const TEAM_NAMES = Object.fromEntries(TEAMS.map((t) => [t.id, t.name]));
const cloud = () => typeof acc.backend?.leaderboard === 'function';
/** Ranked rows for this week, with the student's own team flagged (null when not in cloud mode). */
function hallBoard() {
  if (!cloud() || !S.hallRaw) return cloud() ? { rows: [] } : null;
  return { rows: rankRows(S.hallRaw.rows, { names: TEAM_NAMES, mine: S.settings.hallCup === false ? null : S.settings.hall }), error: S.hallRaw.error };
}
async function loadHallBoard() {
  if (!cloud()) return;
  try { S.hallRaw = { week: weekKey(), rows: await acc.backend.leaderboard(weekKey()) }; }
  catch (e) { S.hallRaw = { week: weekKey(), rows: S.hallRaw?.rows ?? [], error: e.message }; }
  if (!S.selected && S.tab === 'explore') renderPulseNow();
  if (S.tab === 'account' || S.tab === 'activity') meView.render();
}
/**
 * Once per week: announce last week's Hall Cup winner and, if the student's
 * own hall won (and they walked for it), record the win → Hall champion badge.
 */
async function checkHallChampion() {
  if (!cloud()) return;
  const now = new Date(), lastWeek = previousWeek(now, weekKey);
  try {
    const ranked = rankRows(await acc.backend.leaderboard(lastWeek), { names: TEAM_NAMES });
    const winner = winnerOf(ranked);
    S.lastWinner = winner && { ...winner, week: lastWeek };
    if (!S.selected && S.tab === 'explore') renderPulseNow();
    if (!winner) return;
    let announced = null; try { announced = localStorage.getItem('tigerpath.hallAnnounced'); } catch { /* ignore */ }
    let won = false;
    if (acc.user && !(acc.data.hallWins ?? []).includes(lastWeek) && acc.data.settings.hallChecked !== lastWeek) {
      won = isChampion(await acc.backend.myWeek(acc.user, lastWeek), winner);
      acc.update((d) => { d.settings.hallChecked = lastWeek; if (won) d.hallWins = [...(d.hallWins ?? []), lastWeek]; });
    }
    if (announced !== lastWeek) {
      try { localStorage.setItem('tigerpath.hallAnnounced', lastWeek); } catch { /* ignore */ }
      const msg = won ? `🏆 ${winner.name} won last week's Hall Cup — you helped! (${winner.avg.toLocaleString()} avg steps)`
        : `🏆 Last week's Hall Cup winner: ${winner.name} (${winner.avg.toLocaleString()} avg steps)`;
      setTimeout(() => toast(msg, 5000), 1500);
      if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification('Hall Cup results', { body: msg.replace('🏆 ', ''), icon: 'icon.svg', tag: 'hallcup' }));
    }
  } catch { /* offline: try again next time */ }
}
let hallSent = null, hallTimer = null;
/** Share this week's step total with the student's hall (debounced). */
function syncHallCup({ now = false } = {}) {
  clearTimeout(hallTimer);
  hallTimer = setTimeout(async () => {
    if (!acc.user || typeof acc.backend.submitWeek !== 'function') return;
    const week = weekKey(), hall = S.settings.hall;
    try {
      if (!hall || S.settings.hallCup === false) {
        if (hallSent) { await acc.backend.withdrawWeek(acc.user, week); hallSent = null; loadHallBoard(); }
        return;
      }
      const steps = weekStats(acc.data).weekSteps;
      const key = `${week}|${hall}|${steps}`;
      if (steps <= 0 || key === hallSent) return;
      await acc.backend.submitWeek(acc.user, { week, hall, steps });
      hallSent = key; loadHallBoard();
    } catch { /* offline: try again on the next change */ }
  }, now ? 0 : 15000);
}

// ---------------------------------------------------------------- Walk With Me (friend's view)
function startWatching(w) {
  const from = decPlace(w.from), to = decPlace(w.to);
  const r = from && to ? computeRoute(from, to, 'standard') : null;
  createWatchView({
    map, watch: w, routeLatLngs: r?.latlngs, fromLabel: from?.type === 'point' ? `${w.name}'s starting point` : placeLabel(from) || 'their start', toLabel: placeLabel(to) || 'their destination',
    supabaseClient: acc.backend?.kind === 'cloud' ? acc.backend.c : null,
  });
}
async function initAccounts() {
  if (DEMO) {
    acc.backend = new DemoBackend({ buildings: S.buildings, halls: TEAMS.map((t) => t.id).filter((id) => id !== 'COMMUTE') });
    acc.signOut = async () => { location.href = location.pathname; }; // "Sign out" leaves the demo
    document.body.insertAdjacentHTML('beforeend', `<div id="demoBar" role="status"><b>Demo</b> · sample student Jordan · nothing is saved <a href="${location.pathname}">Exit demo</a></div>`);
  } else if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    acc.backend = new SupabaseBackend(createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } else acc.backend = new LocalBackend();
  await acc.init();
  tracker = createTracker({
    acc,
    onFix: (fix) => detectVisit(fix), // buildings you walk into while tracking count as visited
    onUpdate: (_, err) => { if (err) toast(err); if (S.tab === 'account' || S.tab === 'activity') meView.render(); },
    onGoal: () => {
      toast('🎉 You hit your daily goal!', 4000);
      if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification('Goal reached 🎉', { body: 'You hit your TigerPath goal for today.', icon: 'icon.svg', tag: 'goal' }));
    },
  });
  wwm = createWalkWithMe({
    acc, toast,
    getRoute: () => S.lastRoute && { ...S.lastRoute, fromCode: S.from?.type === 'me' && S.me ? `${S.me.lat.toFixed(6)},${S.me.lng.toFixed(6)}` : encPlace(S.from), toCode: encPlace(S.to) },
    getMe: () => S.me,
    ensureLive: () => { if (!S.live) toggleLive(); },
    stopLive: () => { if (S.live) toggleLive(); },
    supabaseClient: acc.backend.kind === 'cloud' ? acc.backend.c : null,
    onArrived: () => checkAchievements(),
  });
  meView = createMeView({ el: $('#meOut'), actEl: $('#actOut'), welcomeEl: $('#welcome'), acc, tracker, toast, buildings: S.buildings, onPrefs,
    onNavigate: (tab) => showTab(tab),
    hallCup: { teams: TEAMS, board: () => hallBoard(), lastWinner: () => S.lastWinner, get cloud() { return cloud(); } },
    phoneSteps: isNative ? { status: () => S.phoneSteps, enable: async () => { S.phoneSteps = await requestStepPermission(); await syncPhoneSteps(); } } : null });
  reminders = createReminders({
    acc, walkMinutes, buildingName: (id) => byId.get(id)?.name ?? id,
    onFire: (r, { title, body, url }) => showBanner(title, body, url),
  });
  acc.onChange(() => {
    reminders.sync(); // iPhone app: keep the scheduled class notifications in step with the schedule
    if (isNative && acc.user && S.phoneSteps == null) syncPhoneSteps();
    checkAchievements();
    syncHallCup();
    walkCache.clear();
    if (S.tab === 'account' || S.tab === 'activity') meView.render();
    if (S.tab === 'schedule') renderSchedule();
    if (!S.selected) renderHome();
    renderReminderCard();
    renderAvatar(); applyTheme();
  });
  renderAvatar();
}
function renderAvatar() {
  const a = $('#acctAvatar');
  if (acc.user) { a.textContent = acc.user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); a.className = 'initials'; }
  else { a.textContent = '👤'; a.className = ''; }
  $('#acctBtn').title = acc.user ? `My account (${acc.user.name})` : 'My account (guest)';
}
/** Apply a preference the student just changed in My account. */
function onPrefs(key) {
  if (key === 'theme') applyTheme();
  if (key === 'home') renderHome();
  if (key === 'hall') { syncHallCup({ now: true }); if (!S.settings.hall) loadHallBoard(); }
  if (['pace', 'avoidStairs', 'strictAccess'].includes(key)) walkCache.clear();
  if (['pace', 'units', 'avoidStairs', 'strictAccess', 'preferredRoute', 'autoNight'].includes(key) && S.from && S.to) updateRoute({ fit: false });
}

function showBanner(title, body, url) {
  const el = $('#banner');
  el.innerHTML = `<div><b>🔔 ${esc(title)}</b><div class="small">${esc(body)}</div></div>
    <div class="btn-row"><a class="btn primary small" href="${esc(url)}" id="bannerGo">Directions</a><button class="btn small" id="bannerX">Dismiss</button></div>`;
  el.hidden = false;
  $('#bannerX').onclick = () => (el.hidden = true);
  $('#bannerGo').onclick = () => (el.hidden = true);
}

function renderReminderCard() {
  const el = $('#reminderCard'); if (!el || !reminders) return;
  const st = S.settings, perm = reminders.permission;
  const next = reminders.plan().find((r) => r.fireAt > new Date());
  const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el.querySelector('.rem-body').innerHTML = `
    <label class="check"><input type="checkbox" id="remOn" ${st.notifications ? 'checked' : ''}/> Remind me before each class</label>
    <div class="row">
      <div class="field"><label for="remLead">How early</label><select id="remLead">
        ${[0, 5, 10, 15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${m === (st.leadMinutes ?? 10) ? 'selected' : ''}>${m ? `${m} minutes before` : 'When it’s time to leave'}</option>`).join('')}
      </select></div></div>
    <label class="check"><input type="checkbox" id="remWalk" ${st.addWalkTime ? 'checked' : ''}/> Add walking time from my previous class</label>
    ${st.notifications && perm === 'denied' ? `<p class="form-error">${isNative
      ? 'Notifications are off for TU TigerPath. Turn them on in Settings → Notifications → TU TigerPath. Until then you’ll see reminders only while the app is open.'
      : 'Notifications are blocked in your browser settings. You’ll still see reminders inside TigerPath while it’s open.'}</p>` : ''}
    ${st.notifications && next ? `<p class="hint">Next: <b>${esc(next.cls.title)}</b> — reminder at ${t(next.fireAt)}${next.leaveBy ? ` (leave by ${t(next.leaveBy)})` : ''}.</p>` : ''}
    <div class="btn-row"><button class="btn small" id="remTest" type="button">Send a test reminder</button></div>
    <p class="hint">${isNative
      ? 'Reminders arrive as notifications even when TigerPath is closed. To see your classes in your calendar too, use <b>Export to calendar</b> below.'
      : 'Reminders appear while TigerPath is open or installed on your phone. For reminders when it’s closed, use <b>Export to calendar</b> below — your calendar app will alert you at the same time.'}</p>`;
  $('#remOn').onchange = async (e) => {
    if (!e.target.checked) { reminders.disable(); return; }
    const p = await reminders.enable();
    toast(p === 'granted' ? 'Class reminders on' : isNative ? 'Allow notifications in Settings to get reminders when TigerPath is closed' : 'Reminders on (inside TigerPath only)', 4000);
  };
  $('#remLead').onchange = (e) => acc.update((d) => { d.settings.leadMinutes = +e.target.value; });
  $('#remWalk').onchange = (e) => acc.update((d) => { d.settings.addWalkTime = e.target.checked; });
  $('#remTest').onclick = async () => { if (reminders.permission === 'default') await Notification.requestPermission(); reminders.test(); };
}

window.__tigerpath = { map, route: () => S.lastRoute?.latlngs ?? null }; // for the browser tests

(async function boot() {
  await loadBasemapMeta();
  setBasemap(S.basemap);
  await loadOsm();
  await loadTu();
  buildGraph();
  await initAccounts();
  initNative({ // iPhone app: resume → refresh steps, reminders, Hall Cup; tapped notification → open its directions
    onResume: () => { syncPhoneSteps(); reminders.sync(); loadHallBoard(); if (!S.selected && S.tab === 'explore') renderPulseNow(); },
    onOpenUrl: (hash) => { location.hash = hash; },
  });
  syncPhoneSteps(); reminders.sync();
  applyTheme();
  $('#demoBtn').onclick = () => { location.href = `${location.pathname}?demo`; };
  $('#tourBtn').onclick = () => { try { sessionStorage.setItem('tigerpath.guestSession', '1'); } catch { /* ignore */ } meView.hideWelcome(); showTab('tour'); };
  // Welcome screen first — unless signed in, already chose guest this session, or opened a shared link
  let guestSession = false; try { guestSession = !!sessionStorage.getItem('tigerpath.guestSession'); } catch { /* ignore */ }
  if (!acc.user && !guestSession && !location.hash && !EDIT) meView.showWelcome();
  drawBuildings(); drawParking(); drawShuttles(); drawSafety(); drawOutlines(); drawAccess();
  applyLayers();
  renderChips(); renderQuick(); renderHome(); renderLayersTab(); initScheduleForm(); renderReminderCard();
  readHash();
  if (!location.hash) updateRoute({ fit: false });
  window.addEventListener('hashchange', readHash);
  if (EDIT) initEditor({ map, buildings: S.buildings, markers, onMove: () => { buildGraph(); walkCache.clear(); if (S.lastRoute) updateRoute({ fit: false }); },
    access: localAccess, onAccessChange: () => { drawAccess(); renderAccessLegend(); } });
  addEventListener('pagehide', () => acc.flush());
  loadWeather(); setInterval(loadWeather, 20 * 60 * 1000);
  loadHallBoard(); setInterval(loadHallBoard, 5 * 60 * 1000); syncHallCup({ now: true }); checkHallChampion();
  checkAchievements();
  if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
})();
