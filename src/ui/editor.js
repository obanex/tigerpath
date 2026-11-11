// Data editor (open the app with ?edit=1).
//
// Lets campus staff fix building positions by dragging pins on the satellite
// map, then download an updated src/data/buildings.js to commit. Moves are
// kept in localStorage so work isn't lost on reload.

import L from 'leaflet';
import buildingsSource from '../data/buildings.js?raw';
import buildingsSourceAccess from '../data/accessibility.js?raw';
import { patchSource } from '../lib/patch.js';
import { ACCESS_FEATURES, ACCESS_TYPES } from '../data/accessibility.js';

const KEY = 'tigerpath.pins';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** Apply saved pin moves (editor only) on top of the bundled data. */
export function applyPinOverrides(buildings) {
  const edit = new URLSearchParams(location.search).has('edit');
  const o = edit ? load() : {};
  return buildings.map((b) => (o[b.id] ? { ...b, ...o[b.id] } : { ...b }));
}

export function initEditor({ map, buildings, markers, onMove, access = [], onAccessChange }) {
  const moves = load();
  const box = document.createElement('div');
  box.className = 'editor';
  box.innerHTML = `<h2>✏️ Data editor</h2>
    <p class="hint">Switch the base map to <b>Satellite</b> and drag each pin onto its building's main entrance.</p>
    <ul id="edList"></ul>
    <div class="btn-row">
      <button class="btn primary" id="edExport">Download buildings.js</button>
      <button class="btn" id="edJson">Copy JSON</button>
      <button class="btn" id="edReset">Reset</button>
    </div>
    <h2>♿ Accessibility</h2>
    <p class="hint">Pick a type, then click the map where it is. Entrances and doors attach to the nearest building.</p>
    <div class="btn-row" id="edTools">
      <button class="btn small" data-t="">Off</button>
      ${Object.entries(ACCESS_TYPES).map(([k, t]) => `<button class="btn small" data-t="${k}">${t.icon} ${t.label}</button>`).join('')}
    </div>
    <ul id="edAccess"></ul>
    <div class="btn-row"><button class="btn primary" id="edAccessExport">Download accessibility.js</button></div>`;
  document.body.appendChild(box);

  const render = () => {
    const ids = Object.keys(moves);
    box.querySelector('#edList').innerHTML = ids.length
      ? ids.map((id) => `<li><b>${id}</b> → ${moves[id].lat}, ${moves[id].lng}</li>`).join('')
      : '<li class="muted">No changes yet.</li>';
  };
  render();

  for (const [id, m] of markers) {
    m.dragging.enable();
    m.on('dragend', () => {
      const { lat, lng } = m.getLatLng();
      moves[id] = { lat: r6(lat), lng: r6(lng) };
      const b = buildings.find((x) => x.id === id);
      Object.assign(b, moves[id]);
      save(moves); render(); onMove?.();
    });
  }
  let tool = '';
  const saveAccess = () => { try { localStorage.setItem('tigerpath.access', JSON.stringify(access)); } catch { /* ignore */ } };
  const renderAccess = () => {
    box.querySelectorAll('#edTools button').forEach((b) => b.classList.toggle('primary', b.dataset.t === tool));
    box.querySelector('#edAccess').innerHTML = access.map((f, i) => `<li>${ACCESS_TYPES[f.type].icon} ${f.building ?? ''} ${r6(f.lat)}, ${r6(f.lng)} <button class="btn small" data-del="${i}">✕</button></li>`).join('')
      || '<li class="muted">None added yet.</li>';
  };
  renderAccess();
  box.querySelector('#edTools').onclick = (e) => { const b = e.target.closest('button'); if (b) { tool = b.dataset.t; renderAccess(); } };
  box.querySelector('#edAccess').onclick = (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    access.splice(+b.dataset.del, 1); saveAccess(); renderAccess(); onAccessChange?.();
  };
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (!tool) { L.popup().setLatLng(e.latlng).setContent(`<code>${r6(lat)}, ${r6(lng)}</code>`).openOn(map); return; }
    const near = buildings.map((b) => ({ b, d: map.distance([b.lat, b.lng], e.latlng) })).sort((x, y) => x.d - y.d)[0];
    const note = prompt(`${ACCESS_TYPES[tool].label}${near && near.d < 120 ? ` at ${near.b.name}` : ''} — note (optional), e.g. "north side, off Towson Way":`, '');
    if (note === null) return;
    access.push({ type: tool, lat: r6(lat), lng: r6(lng), ...(tool !== 'ramp' && near && near.d < 120 ? { building: near.b.id } : {}),
      ...(note ? { note } : {}), verified: new Date().toISOString().slice(0, 10) });
    saveAccess(); renderAccess(); onAccessChange?.();
  });
  box.querySelector('#edAccessExport').onclick = () => {
    const all = [...ACCESS_FEATURES, ...access];
    const src = buildingsSourceAccess.replace(/export const ACCESS_FEATURES = \[[\s\S]*?\];/, `export const ACCESS_FEATURES = ${JSON.stringify(all, null, 2)};`);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), download: 'accessibility.js' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  box.querySelector('#edExport').onclick = () => {
    const blob = new Blob([patchSource(buildingsSource, moves)], { type: 'text/javascript' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'buildings.js' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  box.querySelector('#edJson').onclick = () => navigator.clipboard.writeText(JSON.stringify(moves, null, 2));
  box.querySelector('#edReset').onclick = () => { if (confirm('Discard all pin moves?')) { save({}); location.reload(); } };
}
