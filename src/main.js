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
import { initEditor, applyPinOverrides } from './ui/editor.js';
import { AccountService, LocalBackend, SupabaseBackend } from './lib/account.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createTracker } from './ui/tracker.js';
import { createReminders } from './ui/notify.js';
import { createMeView } from './ui/me.js';
import { ACCESS_FEATURES, ACCESS_TYPES, OFFICIAL_ACCESS_MAP_URL } from './data/accessibility.js';

const CENTER = [39.3925, -76.6110];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('tigerpath.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tigerpath.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const EDIT = new URLSearchParams(location.search).has('edit');

// ---------------------------------------------------------------- state
const S = {
  buildings: applyPinOverrides(BUILDINGS),
  graph: null, graphSource: 'seed', osm: null,
  selected: null, room: null,
  from: null, to: null, profile: 'standard', lastRoute: null,
  me: null, live: false, watchId: null,
  category: null,
  layers: { buildings: true, labels: true, parking: true, shuttle: false, safety: true, outlines: true, access: false, ...store.get('layers', {}) },
  permit: '', basemap: store.get('basemap', 'map'),
  pace: store.get('pace', 1.34), units: store.get('units', 'imperial'),
  day: WEEKDAYS.includes(DAYS[new Date().getDay()]) ? DAYS[new Date().getDay()] : 'mon',
};
// Account (or guest) data: favorites, recent, schedule, goals, activity, settings.
const acc = new AccountService(null);
Object.defineProperties(S, {
  favs: { get: () => acc.data.favs },
  recent: { get: () => acc.data.recent },
  schedule: { get: () => acc.data.schedule },
  settings: { get: () => acc.data.settings },
});
const byId = new Map(S.buildings.map((b) => [b.id, b]));
const parkingById = new Map(PARKING.map((p) => [p.id, p]));
let index = createIndex(S.buildings);
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
  shuttle: L.layerGroup(), safety: L.layerGroup(), access: L.layerGroup(), route: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map),
};
const markers = new Map();

function padding() {
  return isMobile()
    ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, $('#panel').offsetHeight + 20] }
    : { paddingTopLeft: [430, 30], paddingBottomRight: [70, 30] };
}
function flyTo(latlng, zoom = 18) {
  const b = L.latLng(latlng).toBounds(60);
  map.flyToBounds(b, { ...padding(), maxZoom: zoom, duration: 0.6 });
}

function buildingIcon(b) {
  const c = CATEGORIES[b.category]?.color ?? '#333';
  const cls = ['bmark'];
  if (S.selected === b.id) cls.push('sel');
  if (S.category && b.category !== S.category) cls.push('dim');
  return L.divIcon({ className: '', html: `<div class="${cls.join(' ')}" style="background:${c}">${esc(b.id)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
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
document.head.insertAdjacentHTML('beforeend', '<style>.hide-labels .blabel{display:none}.hide-detail .zd{display:none}.far-out .bmark,.far-out .pmark{display:none}.campus-pin{display:none}.far-out .campus-pin{display:flex}</style>');
L.marker(CENTER, { icon: L.divIcon({ className: '', html: '<div class="campus-pin"><span>TU</span>Towson University</div>', iconSize: [190, 36], iconAnchor: [95, 18] }), title: 'Zoom in to Towson University', keyboard: true, zIndexOffset: 2000 })
  .on('click', () => map.flyTo(CENTER, 16)).addTo(map);

function drawParking() {
  layers.parking.clearLayers();
  const list = [...PARKING, ...(S.osm?.parking ?? []).filter((p) => p.name && p.name !== 'Parking' && !PARKING.some((q) => distance(p, q) < 60)).map((p, i) => ({ ...p, id: 'osm-p' + i, kind: 'lot', permits: [], fromOsm: true }))];
  for (const p of list) {
    if (S.permit && !p.permits.includes(S.permit)) continue;
    const permits = p.permits.map((x) => PERMIT_LABELS[x]).join(', ') || 'See signage';
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: p.fromOsm ? 'zd' : '', html: '<div class="pmark">P</div>', iconSize: [24, 24] }), title: p.name })
      .bindPopup(`<b>${esc(p.name)}</b><br><span class="muted">${p.kind === 'garage' ? 'Garage' : 'Lot'} · ${esc(permits)}</span>
        ${p.ev ? '<br>⚡ EV charging' : ''}${p.accessible ? '<br>♿ Accessible spaces' : ''}${p.note ? `<br>${esc(p.note)}` : ''}
        <div class="ctx-menu"><button data-route-to="parking:${esc(p.id)}">Directions here</button><button data-route-from="parking:${esc(p.id)}">Walk from here</button></div>`)
      .addTo(layers.parking);
    if (!parkingById.has(p.id)) parkingById.set(p.id, p);
  }
}
function drawShuttles() {
  layers.shuttle.clearLayers();
  for (const r of SHUTTLES) {
    const pts = r.stops.map((s) => [s.lat, s.lng]);
    L.polyline([...pts, pts[0]], { color: r.color, weight: 5, opacity: 0.9, dashArray: r.sample ? '8 8' : null }).bindTooltip(r.name).addTo(layers.shuttle);
    r.stops.forEach((s) => L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="smark">🚌</div>', iconSize: [22, 22] }), title: s.name })
      .bindPopup(`<b>${esc(s.name)}</b><br>${esc(r.name)}<br><a href="${LIVE_SHUTTLE_URL}" target="_blank" rel="noopener">Live arrivals ↗</a>`).addTo(layers.shuttle));
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
  for (const o of S.osm?.buildings ?? []) {
    const match = o.ourId && byId.get(o.ourId);
    L.polygon(o.outline, { weight: 1, color: match ? CATEGORIES[match.category].color : '#888', fillOpacity: match ? 0.25 : 0.08, interactive: !!match })
      .on('click', () => match && selectBuilding(match.id)).addTo(layers.outlines);
  }
}
// ---------------------------------------------------------------- accessibility
let localAccess = [];
try { localAccess = EDIT ? JSON.parse(localStorage.getItem('tigerpath.access')) ?? [] : []; } catch { /* none */ }
const accessFeatures = () => [...ACCESS_FEATURES, ...localAccess];
const accessEntrances = (id) => accessFeatures().filter((f) => f.building === id && (f.type === 'entrance' || f.type === 'automatic-door'));
const canvas = L.canvas({ padding: 0.3 });

/** Step-free footpaths, stairs to avoid, rough surfaces, curb cuts, accessible parking, ramps/entrances/elevators. */
function drawAccess() {
  layers.access.clearLayers();
  if (S.osm) {
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
    const t = ACCESS_TYPES[f.type] ?? { label: f.type, icon: '♿' };
    L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: `<div class="amark" aria-hidden="true">${t.icon}</div>`, iconSize: [24, 24] }), title: t.label })
      .bindPopup(`<b>${t.icon} ${esc(t.label)}</b>${f.building ? `<br>${esc(byId.get(f.building)?.name ?? f.building)}` : ''}${f.note ? `<br>${esc(f.note)}` : ''}${f.verified ? `<br><span class="muted">Checked ${esc(f.verified)}</span>` : ''}`)
      .addTo(layers.access);
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
  const pts = [...S.buildings, ...PARKING].map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name }));
  if (S.osm) {
    S.graph = graphFromProcessed(S.osm);
    const walk = S.graph.mainComponent(); // ignore isolated fragments (gated fields, private drives)
    for (const p of pts) { // connect each place to the 2 nearest walkway nodes
      const near = S.graph.nearest(p, 2, (n) => walk.has(n.id));
      S.graph.addNode(p.id, p.lat, p.lng, p.label);
      for (const n of near) if (n.d < 200) S.graph.addEdge(p.id, n.id);
    }
    S.graphSource = 'osm';
  } else {
    S.graph = buildSeedGraph(pts);
    S.graphSource = 'seed';
  }
  S.mainNodes = S.graph.mainComponent();
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
/** Resolve a place to a graph node id. Returns { id, label, latlng, cleanup }. */
function placeNode(place, profile = 'standard') {
  if (!place) return null;
  if (place.type === 'building') {
    const b = byId.get(place.id); if (!b) return null;
    const doors = profile === 'accessible' ? accessEntrances(b.id) : [];
    if (doors.length) { // ♿ route to the nearest listed accessible entrance, not the building center
      const door = doors[0];
      const n = placeNode({ type: 'point', lat: door.lat, lng: door.lng, label: `${b.name} (accessible entrance)` });
      return n;
    }
    return { id: b.id, label: b.name, latlng: [b.lat, b.lng], cleanup() {} };
  }
  if (place.type === 'parking') { const p = parkingById.get(place.id); return p && S.graph.nodes.has(p.id) && { id: p.id, label: p.name, latlng: [p.lat, p.lng], cleanup() {} }; }
  const pt = place.type === 'me' ? S.me : place;
  if (!pt) return null;
  const id = '@tmp' + ++tmpSeq;
  const near = S.graph.nearest(pt, 3, (n) => S.mainNodes.has(n.id));
  if (!near.length || near[0].d > 300) return { far: true, cleanup() {} }; // walking paths only cover campus; don't invent long straight-line links
  S.graph.addNode(id, pt.lat, pt.lng);
  near.forEach((n) => S.graph.addEdge(id, n.id));
  const label = place.type === 'me' ? 'your location' : place.label ?? 'dropped pin';
  return { id, label, latlng: [pt.lat, pt.lng], cleanup() { near.forEach((n) => S.graph.removeEdge(id, n.id)); S.graph.nodes.delete(id); S.graph.adj.delete(id); } };
}
const speed = (profile) => (profile === 'accessible' ? Math.min(S.pace, 1.0) : S.pace);
function computeRoute(fromPlace, toPlace, profile = S.profile) {
  const a = placeNode(fromPlace, profile), b = placeNode(toPlace, profile);
  try {
    if (!a || !b) return null;
    if (a.far || b.far) return { far: true, a, b, res: null };
    const res = route(S.graph, a.id, b.id, profile, { phones: safety.some((s) => s.kind === 'phone'), strict: !!S.settings.strictAccess });
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
const TABS = ['explore', 'directions', 'schedule', 'me', 'layers'];
function showTab(name) {
  for (const t of TABS) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`#view-${t}`).hidden = t !== name;
  }
  S.tab = name;
  if (name === 'schedule') renderSchedule();
  if (name === 'me') meView?.render();
  if (name !== 'directions' && name !== 'schedule') layers.route.clearLayers();
  if (name === 'directions' && S.lastRoute) drawRoute(S.lastRoute);
  writeHash();
}
TABS.forEach((t) => $(`#tab-${t}`).addEventListener('click', () => showTab(t)));
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const i = TABS.indexOf(S.tab ?? 'explore') + (e.key === 'ArrowRight' ? 1 : -1);
  const t = TABS[(i + TABS.length) % TABS.length]; showTab(t); $(`#tab-${t}`).focus();
});
const SHEET = ['peek', 'half', 'full'];
$('#sheetHandle').addEventListener('click', () => {
  const p = $('#panel'); p.dataset.sheet = SHEET[(SHEET.indexOf(p.dataset.sheet) + 1) % 3];
});
const sheet = (s) => { if (isMobile()) $('#panel').dataset.sheet = s; };

// ---------------------------------------------------------------- generic UI helpers
function renderSeg(sel, options, current, onPick) {
  const el = $(sel);
  el.innerHTML = options.map(([v, label]) => `<button role="radio" aria-checked="${v === current}" data-v="${esc(v)}">${esc(label)}</button>`).join('');
  el.onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v != null) onPick(v); };
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
async function share(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
}

/** Typeahead on an input. onPick(item) gets { type, id, ... }. */
function attachTypeahead(input, list, onPick, { allowMe = false } = {}) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const render = () => {
    const q = input.value.trim();
    items = q ? search(index, q).map((r) => ({ type: 'building', id: r.item.id, b: r.item, room: r.room })) : [];
    if (allowMe && (!q || 'my location'.startsWith(q.toLowerCase()))) items.unshift({ type: 'me' });
    if (!items.length) {
      list.innerHTML = q ? '<li class="muted" aria-disabled="true">No matches. Try a building code like “LA” or a department.</li>' : '';
      list.hidden = !q; return;
    }
    list.innerHTML = items.map((it, i) => it.type === 'me'
      ? `<li role="option" id="${list.id || input.id}-o${i}" data-i="${i}"><span class="code">📍</span><div>My location</div></li>`
      : `<li role="option" id="${list.id || input.id}-o${i}" data-i="${i}"><span class="code">${esc(it.b.id)}</span><div>${esc(it.b.name)}${it.room ? ` · Room ${esc(it.room.room)}` : ''}
          <div class="sub">${esc(CATEGORIES[it.b.category].label)}${it.b.depts?.length ? ' · ' + esc(it.b.depts.slice(0, 2).join(', ')) : ''}</div></div></li>`).join('');
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
      map.flyToBounds(L.latLngBounds(bs.map((b) => [b.lat, b.lng])), { ...padding(), maxZoom: 18, duration: 0.6 });
      renderCategoryList(bs);
    } else renderHome();
  };
}
function renderCategoryList(bs) {
  $('#detail').hidden = true; $('#home').hidden = false;
  $('#nearestOut').innerHTML = `<h2 class="h">${esc(CATEGORIES[S.category].label)} · ${bs.length}</h2><ul class="list">${bs.map((b) => {
    const st = openStatus(b.hours);
    return `<li><span class="code">${esc(b.id)}</span><button class="link" data-b="${esc(b.id)}">${esc(b.name)}${st.label ? `<div class="sub ${st.open ? 'status open' : 'status closed'}" style="margin:0">${esc(st.label)}</div>` : ''}</button></li>`;
  }).join('')}</ul>`;
}

function selectBuilding(id, { room = null, fly = true } = {}) {
  const b = byId.get(id); if (!b) return;
  S.selected = id; S.room = room;
  acc.update((d) => { d.recent = [id, ...d.recent.filter((x) => x !== id)].slice(0, 6); });
  refreshMarkers();
  if (fly) flyTo([b.lat, b.lng]);
  if (S.tab !== 'explore') showTab('explore');
  renderDetail(); sheet('half'); writeHash();
}
function renderDetail() {
  const b = byId.get(S.selected);
  const el = $('#detail');
  if (!b) { el.hidden = true; $('#home').hidden = false; return; }
  const cat = CATEGORIES[b.category];
  const st = openStatus(b.hours);
  const today = DAY_LABELS[DAYS[new Date().getDay()]];
  const fav = S.favs.includes(b.id);
  el.innerHTML = `
    <button class="back" id="backBtn">← Back</button>
    <div class="detail-head"><span class="code" style="background:${cat.color};color:#fff;font-size:.9rem;padding:6px 8px">${esc(b.id)}</span>
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
    ${b.depts?.length ? `<h2 class="h">Inside</h2><div>${b.depts.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</div>` : ''}
    ${b.food?.length ? `<h2 class="h">Food here</h2><div>${b.food.map((f) => `<span class="tag">🍴 ${esc(f)}</span>`).join('')}</div>` : ''}
    ${b.amenities?.length ? `<h2 class="h">Amenities</h2><div>${b.amenities.map((a) => `<span class="tag">${esc(AMENITY_LABELS[a] ?? a)}</span>`).join('')}</div>` : ''}
    ${b.hours ? `<h2 class="h">Hours</h2><table class="hours">${weekTable(b.hours).map((r) => `<tr class="${r.day === today ? 'today' : ''}"><td>${r.day}</td><td>${esc(r.text)}</td></tr>`).join('')}</table>` : ''}
    <h2 class="h">♿ Accessibility</h2>${accessCard(b)}
    <h2 class="h">Nearby</h2><ul class="list" id="nearby"></ul>`;
  el.hidden = false; $('#home').hidden = true;
  $('#backBtn').onclick = () => { S.selected = null; S.room = null; refreshMarkers(); renderDetail(); renderHome(); writeHash(); };
  $('#dirTo').onclick = () => { setPlace('to', { type: 'building', id: b.id }); if (!S.from && S.me) setPlace('from', { type: 'me' }); showTab('directions'); if (!S.from) $('#from').focus(); };
  $('#dirFrom').onclick = () => { setPlace('from', { type: 'building', id: b.id }); showTab('directions'); if (!S.to) $('#to').focus(); };
  $('#favBtn').onclick = () => { acc.update((d) => { d.favs = fav ? d.favs.filter((x) => x !== b.id) : [...d.favs, b.id]; }); renderDetail(); };
  $('#shareBtn').onclick = () => share(location.href, b.name);
  $('#stepFree').onclick = () => { S.profile = 'accessible'; renderProfiles(); if (!S.layers.access) { S.layers.access = true; applyLayers(); renderLayersTab(); } $('#dirTo').click(); };
  const near = S.buildings.filter((x) => x.id !== b.id).map((x) => ({ x, d: distance(b, x) })).sort((p, q) => p.d - q.d).slice(0, 4);
  $('#nearby').innerHTML = near.map(({ x, d }) => `<li><span class="code">${esc(x.id)}</span><button class="link" data-b="${esc(x.id)}">${esc(x.name)}</button><span class="muted">${formatDistance(d, S.units)}</span></li>`).join('');
}

function accessCard(b) {
  const feats = accessFeatures().filter((f) => f.building === b.id);
  const parking = (S.osm?.access?.parking ?? []).map((p) => ({ p, d: distance(b, p) })).sort((x, y) => x.d - y.d)[0];
  const items = feats.map((f) => `<li>${ACCESS_TYPES[f.type]?.icon ?? '♿'} ${esc(ACCESS_TYPES[f.type]?.label ?? f.type)}${f.note ? ` — ${esc(f.note)}` : ''}</li>`);
  if (parking && parking.d < 400) items.push(`<li>♿ Accessible parking ${formatDistance(parking.d, S.units)} away (${parking.p.capacity} space${parking.p.capacity > 1 ? 's' : ''})</li>`);
  return `<ul class="access-list">${items.join('') || '<li class="muted">No accessible entrances, ramps or elevators mapped for this building yet.</li>'}</ul>
    <div class="btn-row"><button class="btn small" id="stepFree">♿ Step-free route here</button>
    <a class="btn small" href="${OFFICIAL_ACCESS_MAP_URL}" target="_blank" rel="noopener">TU accessibility map ↗</a></div>`;
}

function renderHome() {
  $('#nearestOut').innerHTML = '';
  const li = (id) => { const b = byId.get(id); return b ? `<li><span class="code">${esc(b.id)}</span><button class="link" data-b="${esc(b.id)}">${esc(b.name)}</button></li>` : ''; };
  $('#favs').innerHTML = S.favs.map(li).join('') || '<li class="muted">Tap ☆ on a building to save it.</li>';
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
    ? PARKING.filter((p) => !S.permit || p.permits.includes(S.permit)).map((p) => ({ place: { type: 'parking', id: p.id }, name: p.name, id: 'P' }))
    : S.buildings.filter(q.match).filter((b) => b.id !== S.selected).map((b) => ({ place: { type: 'building', id: b.id }, name: b.name, id: b.id, st: openStatus(b.hours) }))
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
    const place = type === 'pt' ? (([lat, lng]) => ({ type: 'point', lat: +lat, lng: +lng, label: 'dropped pin' }))(v.split(',')) : { type, id: v };
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

const PROFILE_HINT = {
  standard: 'Shortest walking route.',
  accessible: 'Avoids stairs, raised curbs and paths marked not wheelchair-accessible; prefers ramps and curb cuts; uses a slower pace for time estimates.',
  night: 'Prefers lit paths and paths near emergency phones.',
};
function renderProfiles() {
  renderSeg('#profiles', Object.entries(PROFILES).map(([k, p]) => [k, (k === 'accessible' ? '♿ ' : k === 'night' ? '🌙 ' : '🚶 ') + p.label]), S.profile, (v) => {
    S.profile = v;
    if (v === 'accessible' && !S.layers.access) { S.layers.access = true; applyLayers(); renderLayersTab(); }
    renderProfiles(); updateRoute();
  });
  let hint = PROFILE_HINT[S.profile];
  if (S.graphSource === 'seed' && S.profile !== 'standard') hint += ' Load OpenStreetMap path data (npm run fetch-osm) for full stairs and lighting detail.';
  $('#profileHint').innerHTML = esc(hint) + (S.profile === 'accessible'
    ? `<label class="check"><input type="checkbox" id="strictAccess" ${S.settings.strictAccess ? 'checked' : ''}/> Also avoid steep slopes and rough surfaces (gravel, grass)</label>` : '');
  const strict = $('#strictAccess');
  if (strict) strict.onchange = () => { acc.update((d) => { d.settings.strictAccess = strict.checked; }); walkCache.clear(); updateRoute({ fit: false }); };
}

function drawRoute(r) {
  layers.route.clearLayers();
  if (!r?.res) return;
  L.polyline(r.latlngs, { color: '#fff', weight: 10, opacity: 0.9 }).addTo(layers.route);
  L.polyline(r.latlngs, { color: S.profile === 'accessible' ? '#7c3aed' : S.profile === 'night' ? '#0f172a' : '#2563eb', weight: 6 }).addTo(layers.route);
  r.res.edges.forEach((e, i) => { if (e.stairs) L.polyline([r.latlngs[i], r.latlngs[i + 1]], { color: '#dc2626', weight: 6, dashArray: '4 6' }).bindTooltip('Stairs').addTo(layers.route); });
  L.circleMarker(r.latlngs[0], { radius: 8, color: '#111', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Start: ' + r.a.label).addTo(layers.route);
  L.marker(r.latlngs.at(-1), { icon: L.divIcon({ className: '', html: '<div class="numark">★</div>', iconSize: [28, 28] }), interactive: false }).addTo(layers.route);
}
function updateRoute({ fit = true } = {}) {
  const out = $('#routeOut');
  writeHash();
  if (!S.from || !S.to) { S.lastRoute = null; layers.route.clearLayers(); out.innerHTML = '<p class="hint">Choose where you’re starting and where you’re going. Tip: right-click or long-press the map to drop a pin.</p>'; return; }
  if (S.from.type === 'me' && !S.me) { out.innerHTML = '<p class="hint">Waiting for your location…</p>'; return; }
  const r = computeRoute(S.from, S.to);
  S.lastRoute = r;
  if (r?.far) { layers.route.clearLayers(); out.innerHTML = '<p class="hint">Walking directions cover the Towson campus and the streets right around it. That spot is too far from campus paths. Try a closer starting point.</p>'; return; }
  if (!r?.res) { layers.route.clearLayers(); out.innerHTML = '<p class="hint">No route found with these settings. Try another route type.</p>'; return; }
  drawRoute(r);
  if (fit) map.flyToBounds(L.latLngBounds(r.latlngs), { ...padding(), maxZoom: 18, duration: 0.6 });
  const arrive = new Date(Date.now() + r.minutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const stairs = r.res.edges.filter((e) => e.stairs).length;
  out.innerHTML = `
    <div class="summary"><span class="big">${formatMinutes(r.minutes)}</span><span class="muted">${formatDistance(r.res.dist, S.units)} · arrive ${arrive}</span></div>
    ${stairs ? `<p class="hint">⚠️ Includes ${stairs} stair segment${stairs > 1 ? 's' : ''} (red dashes). Choose ♿ Accessible to avoid them.</p>` : ''}
    <div class="btn-row"><button class="btn primary" id="liveBtn">${S.live ? '■ Stop' : '▶ Start walking'}</button><button class="btn" id="shareRoute">Share route</button><button class="btn" id="printRoute">Print</button></div>
    <ol class="steps">${r.steps.map((s, i) => `<li data-step="${i}"><span class="ico">${s.type === 'arrive' ? '★' : s.type === 'depart' ? '●' : /left/.test(s.text) ? '↰' : /right/.test(s.text) ? '↱' : '↑'}</span>
      <span>${esc(s.text)}</span><span class="d">${s.dist ? formatDistance(s.dist, S.units) : ''}</span></li>`).join('')}</ol>
    ${S.graphSource === 'seed' ? '<p class="hint">Routes use an approximate campus path network. Follow posted signs and sidewalks.</p>' : '<p class="hint">Walkway data © OpenStreetMap contributors.</p>'}`;
  $('#routeOut .steps').onclick = (e) => { const li = e.target.closest('[data-step]'); if (li) { const s = r.steps[+li.dataset.step]; flyTo([s.at.lat, s.at.lng], 19); } };
  $('#shareRoute').onclick = () => share(location.href, `Walk to ${r.b.label}`);
  $('#printRoute').onclick = () => window.print();
  $('#liveBtn').onclick = toggleLive;
}

// Live walking: follow the user, show remaining time, reroute when off course.
function toggleLive() {
  S.live = !S.live;
  if (S.live) {
    if (S.from?.type !== 'me') { setPlace('from', { type: 'me' }); }
    startWatch(); toast(acc.user ? 'Following your location — this walk counts toward your goals.' : 'Following your location. Keep the app open.');
    tracker.start('nav').catch(() => {});
  } else if (tracker.source === 'nav') tracker.stop();
  updateRoute({ fit: !S.live });
}
function onLiveUpdate() {
  const r = S.lastRoute; if (!S.live || !r?.res) return;
  map.panTo([S.me.lat, S.me.lng], { animate: true });
  const off = Math.min(...r.latlngs.map(([lat, lng]) => distance(S.me, { lat, lng })));
  const end = { lat: r.latlngs.at(-1)[0], lng: r.latlngs.at(-1)[1] };
  if (distance(S.me, end) < 20) { S.live = false; if (tracker.source === 'nav') tracker.stop(); toast(`You’ve arrived at ${r.b.label} 🎉`, 4000); updateRoute({ fit: false }); return; }
  if (off > 40) { toast('Off route — rerouting'); updateRoute({ fit: false }); }
  else if (S.from?.type === 'me') updateRoute({ fit: false });
}

// ---------------------------------------------------------------- location
let meMarker, meCircle;
function startWatch() {
  if (S.watchId != null || !navigator.geolocation) return;
  S.watchId = navigator.geolocation.watchPosition((pos) => {
    const first = !S.me;
    S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    if (!meMarker) {
      meMarker = L.marker([S.me.lat, S.me.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), interactive: false, keyboard: false }).addTo(layers.me);
      meCircle = L.circle([S.me.lat, S.me.lng], { radius: S.me.acc, weight: 1, color: '#2563eb', fillOpacity: 0.08, interactive: false }).addTo(layers.me);
    } else { meMarker.setLatLng([S.me.lat, S.me.lng]); meCircle.setLatLng([S.me.lat, S.me.lng]).setRadius(S.me.acc); }
    $('#locateBtn').classList.add('active');
    if (first) {
      const far = distance(S.me, { lat: CENTER[0], lng: CENTER[1] }) > 3000;
      if (far) toast('You appear to be off campus — routes start from the nearest campus path.', 4000);
      else map.flyTo([S.me.lat, S.me.lng], 18);
      if (S.from?.type === 'me' || S.to?.type === 'me') updateRoute();
    }
    onLiveUpdate();
  }, (err) => { toast(err.code === 1 ? 'Location permission denied' : 'Could not get your location'); S.watchId = null; }, { enableHighAccuracy: true, maximumAge: 5000 });
}
function locate() { if (S.me) map.flyTo([S.me.lat, S.me.lng], 18); startWatch(); }
$('#locateBtn').onclick = locate;
$('#resetBtn').onclick = () => map.flyTo(CENTER, 16);

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
        <button class="icon-btn" data-del="${esc(c.id)}" aria-label="Remove ${esc(c.title)}">✕</button></div>
      ${leg ? `<div class="leg ${leg.status}">${LEG_TEXT[leg.status](leg)}</div>` : ''}`;
  }).join('');
  el.querySelectorAll('[data-del]').forEach((btn) => btn.onclick = () => { acc.update((d) => { d.schedule = d.schedule.filter((c) => c.id !== btn.dataset.del); }); renderSchedule(); });
  el.querySelectorAll('[data-room]').forEach((a) => a.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const room = a.dataset.room ? search(index, `${a.dataset.b} ${a.dataset.room}`)[0]?.room : null;
    selectBuilding(a.dataset.b, { room });
  });
  drawDay(plan);
}
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
  if (all.length) map.flyToBounds(L.latLngBounds(all), { ...padding(), maxZoom: 18, duration: 0.6 });
}
function initScheduleForm() {
  $('#cBldg').innerHTML = [...S.buildings].sort((a, b) => a.name.localeCompare(b.name))
    .filter((b) => b.category !== 'landmark').map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.id)})</option>`).join('');
  $('#cDays').innerHTML = WEEKDAYS.map((d) => `<label><input type="checkbox" value="${d}" />${DAY_LABELS[d]}</label>`).join('');
  $('#classForm').onsubmit = (e) => {
    e.preventDefault();
    const days = [...$('#cDays').querySelectorAll('input:checked')].map((i) => i.value);
    if (!days.length) { toast('Pick at least one day'); return; }
    if ($('#cEnd').value <= $('#cStart').value) { toast('End time must be after start time'); return; }
    const cls = { id: crypto.randomUUID?.() ?? String(Date.now()), title: $('#cTitle').value.trim(), building: $('#cBldg').value,
      room: $('#cRoom').value.trim(), days, start: $('#cStart').value, end: $('#cEnd').value };
    acc.update((d) => { d.schedule.push(cls); });
    if (!days.includes(S.day)) S.day = days[0];
    e.target.reset(); $('#cStart').value = '09:30'; $('#cEnd').value = '10:45';
    renderSchedule(); toast('Class added');
  };
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
  $('#pace').value = String(S.pace);
  $('#pace').onchange = (e) => { S.pace = +e.target.value; store.set('pace', S.pace); walkCache.clear(); if (S.lastRoute) updateRoute({ fit: false }); };
  $('#units').value = S.units;
  $('#units').onchange = (e) => { S.units = e.target.value; store.set('units', S.units); if (S.lastRoute) updateRoute({ fit: false }); };
  $('#shuttleNote').innerHTML = `Shuttle lines shown are a sample. <a href="${LIVE_SHUTTLE_URL}" target="_blank" rel="noopener">Official shuttle info ↗</a>`;
  const phones = safety.length;
  $('#dataNote').innerHTML = (S.graphSource === 'osm'
    ? `Walkways from OpenStreetMap (${new Date(S.osm.generated).toLocaleDateString()}): ${S.osm.edges.length.toLocaleString()} path segments.`
    : 'Routing uses an approximate path network between buildings. Run <code>npm run fetch-osm</code> to load real walkways.')
    + (phones ? ` ${phones} emergency phones/AEDs loaded.` : ' No verified emergency phone data loaded yet.')
    + (S.graphSource === 'osm' ? ' Building locations from OpenStreetMap footprints.' : ' Building positions are approximate until verified.');
}

function renderAccessLegend() {
  const el = $('#accessLegend'); if (!el) return;
  el.hidden = !S.layers.access;
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
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  store.set('theme', t ?? null);
  if (S.basemap === 'map' && selfHosted) setBasemap('map'); // switch light/dark map style
}
$('#themeBtn').onclick = () => applyTheme(isDark() ? 'light' : 'dark');

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
  if (S.tab === 'directions') { if (S.from) p.set('from', encPlace(S.from)); if (S.to) p.set('to', encPlace(S.to)); if (S.profile !== 'standard') p.set('mode', S.profile); }
  else if (S.tab === 'schedule') { p.set('tab', 'classes'); p.set('day', S.day); }
  else if (S.tab === 'layers') p.set('tab', 'layers');
  else if (S.tab === 'me') p.set('tab', 'me');
  else if (S.selected) { p.set('b', S.selected); if (S.room) p.set('room', S.room.room); }
  const h = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
}
function readHash() {
  applyingHash = true;
  const p = new URLSearchParams(location.hash.slice(1));
  try {
    if (p.has('from') || p.has('to')) {
      if (p.get('mode') in PROFILES) S.profile = p.get('mode');
      renderProfiles();
      S.from = decPlace(p.get('from')); S.to = decPlace(p.get('to'));
      $('#from').value = placeLabel(S.from); $('#to').value = placeLabel(S.to);
      if (S.from?.type === 'me' || S.to?.type === 'me') startWatch();
      showTab('directions'); updateRoute();
    } else if (p.get('tab') === 'classes') {
      if (WEEKDAYS.includes(p.get('day'))) S.day = p.get('day');
      showTab('schedule');
    } else if (p.get('tab') === 'layers') showTab('layers');
    else if (p.get('tab') === 'me') showTab('me');
    else if (p.has('b') && byId.has(p.get('b'))) {
      const room = p.get('room') ? search(index, `${p.get('b')} ${p.get('room')}`)[0]?.room : null;
      selectBuilding(p.get('b'), { room });
    } else showTab('explore');
  } finally { applyingHash = false; }
}

// ---------------------------------------------------------------- search box (explore)
attachTypeahead($('#q'), $('#qResults'), (it) => {
  if (it.type === 'me') { locate(); return; }
  $('#q').value = it.b.name; selectBuilding(it.id, { room: it.room ?? null });
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
      if (!overrides[id]) { const b = byId.get(id); b.lat = o.lat; b.lng = o.lng; } // real footprint beats seed pin
    }
    safety.push(...data.safety);
  } catch { /* no OSM data bundled — seed data is used */ }
}

// ---------------------------------------------------------------- accounts, activity, reminders
let meView, tracker, reminders;
async function initAccounts() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    acc.backend = new SupabaseBackend(createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  } else acc.backend = new LocalBackend();
  await acc.init();
  tracker = createTracker({
    acc,
    onUpdate: (_, err) => { if (err) toast(err); if (S.tab === 'me') meView.render(); },
    onGoal: () => {
      toast('🎉 You hit your daily goal!', 4000);
      if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification('Goal reached 🎉', { body: 'You hit your TigerPath goal for today.', icon: 'icon.svg', tag: 'goal' }));
    },
  });
  meView = createMeView({ el: $('#meOut'), acc, tracker, toast, backendKind: acc.backend.kind });
  reminders = createReminders({
    acc, walkMinutes, buildingName: (id) => byId.get(id)?.name ?? id,
    onFire: (r, { title, body, url }) => showBanner(title, body, url),
  });
  acc.onChange(() => {
    walkCache.clear();
    if (S.tab === 'me') meView.render();
    if (S.tab === 'schedule') renderSchedule();
    if (!S.selected) renderHome();
    renderReminderCard();
    $('#tab-me').textContent = acc.user ? 'Me' : 'Sign in';
  });
  $('#tab-me').textContent = acc.user ? 'Me' : 'Sign in';
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
    ${st.notifications && perm === 'denied' ? '<p class="form-error">Notifications are blocked in your browser settings. You’ll still see reminders inside TigerPath while it’s open.</p>' : ''}
    ${st.notifications && next ? `<p class="hint">Next: <b>${esc(next.cls.title)}</b> — reminder at ${t(next.fireAt)}${next.leaveBy ? ` (leave by ${t(next.leaveBy)})` : ''}.</p>` : ''}
    <div class="btn-row"><button class="btn small" id="remTest" type="button">Send a test reminder</button></div>
    <p class="hint">Reminders appear while TigerPath is open or installed on your phone. For reminders when it’s closed, use <b>Export to calendar</b> below — your calendar app will alert you at the same time.</p>`;
  $('#remOn').onchange = async (e) => { if (e.target.checked) { const p = await reminders.enable(); toast(p === 'granted' ? 'Class reminders on' : 'Reminders on (inside TigerPath only)'); } else reminders.disable(); };
  $('#remLead').onchange = (e) => acc.update((d) => { d.settings.leadMinutes = +e.target.value; });
  $('#remWalk').onchange = (e) => acc.update((d) => { d.settings.addWalkTime = e.target.checked; });
  $('#remTest').onclick = async () => { if (reminders.permission === 'default') await Notification.requestPermission(); reminders.test(); };
}

window.__tigerpath = { map }; // for the browser smoke test

(async function boot() {
  const theme = store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  await loadBasemapMeta();
  setBasemap(S.basemap);
  await loadOsm();
  buildGraph();
  await initAccounts();
  drawBuildings(); drawParking(); drawShuttles(); drawSafety(); drawOutlines(); drawAccess();
  applyLayers();
  renderChips(); renderQuick(); renderHome(); renderProfiles(); renderLayersTab(); initScheduleForm(); renderReminderCard();
  readHash();
  if (!location.hash) updateRoute({ fit: false });
  window.addEventListener('hashchange', readHash);
  if (EDIT) initEditor({ map, buildings: S.buildings, markers, onMove: () => { buildGraph(); walkCache.clear(); if (S.lastRoute) updateRoute({ fit: false }); },
    access: localAccess, onAccessChange: () => { drawAccess(); renderAccessLegend(); } });
  addEventListener('pagehide', () => acc.flush());
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
})();
