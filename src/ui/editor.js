// Data editor (open the app with ?edit=1).
//
// Lets campus staff fix building positions by dragging pins on the satellite
// map, then download an updated src/data/buildings.js to commit. Moves are
// kept in localStorage so work isn't lost on reload.

import L from 'leaflet';
import buildingsSource from '../data/buildings.js?raw';
import { patchSource } from '../lib/patch.js';

const KEY = 'tigernav.pins';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

/** Apply saved pin moves (editor only) on top of the bundled data. */
export function applyPinOverrides(buildings) {
  const edit = new URLSearchParams(location.search).has('edit');
  const o = edit ? load() : {};
  return buildings.map((b) => (o[b.id] ? { ...b, ...o[b.id] } : { ...b }));
}

export function initEditor({ map, buildings, markers, onMove }) {
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
    </div>`;
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
  map.on('click', (e) => {
    L.popup().setLatLng(e.latlng).setContent(`<code>${r6(e.latlng.lat)}, ${r6(e.latlng.lng)}</code>`).openOn(map);
  });

  box.querySelector('#edExport').onclick = () => {
    const blob = new Blob([patchSource(buildingsSource, moves)], { type: 'text/javascript' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'buildings.js' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  box.querySelector('#edJson').onclick = () => navigator.clipboard.writeText(JSON.stringify(moves, null, 2));
  box.querySelector('#edReset').onclick = () => { if (confirm('Discard all pin moves?')) { save({}); location.reload(); } };
}
