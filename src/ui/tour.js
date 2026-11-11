// Self-guided tour: route through the stops on the map, one stop at a time in
// the panel, auto-advance on arrival, read-aloud, step-free option.

import L from 'leaflet';
import { TOUR } from '../data/tour.js';
import { distance, formatDistance, formatMinutes } from '../lib/geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'tigerpath.tour';
const ARRIVE_M = 40;

/**
 * ctx: { map, el, byId, layer (L.LayerGroup), computeRoute(from, to, profile), fitView(bounds), units(), toast,
 *        onExit(), startLocation(), hasLocation() }
 */
export function createTour(ctx) {
  const stops = TOUR.stops.map((s) => ({ ...s, b: ctx.byId.get(s.building) })).filter((s) => s.b);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { /* ignore */ }
  let i = Math.min(saved.i ?? 0, stops.length - 1), stepFree = !!saved.stepFree, legs = [], auto = false, speaking = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ i, stepFree })); } catch { /* ignore */ } };

  function computeLegs() {
    legs = [];
    for (let k = 0; k + 1 < stops.length; k++) {
      const r = ctx.computeRoute({ type: 'building', id: stops[k].b.id }, { type: 'building', id: stops[k + 1].b.id }, stepFree ? 'accessible' : 'standard');
      legs.push(r?.res ? r : null);
    }
  }
  const totals = () => legs.reduce((t, r) => ({ m: t.m + (r?.res.dist ?? 0), min: t.min + (r?.minutes ?? 0) }), { m: 0, min: 0 });

  function draw() {
    ctx.layer.clearLayers();
    legs.forEach((r, k) => {
      if (!r) return;
      const done = k < i;
      L.polyline(r.latlngs, { color: '#fff', weight: 9, opacity: 0.9 }).addTo(ctx.layer);
      L.polyline(r.latlngs, { color: done ? '#a3a3a3' : '#e0a100', weight: 5, dashArray: k === i ? null : '2 9', lineCap: 'round' }).addTo(ctx.layer);
    });
    stops.forEach((s, k) => {
      L.marker([s.b.lat, s.b.lng], {
        icon: L.divIcon({ className: '', html: `<div class="tourmark${k === i ? ' cur' : k < i ? ' done' : ''}">${k + 1}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
        title: `Stop ${k + 1}: ${s.title ?? s.b.name}`, zIndexOffset: 1500 + (k === i ? 100 : 0),
      }).on('click', () => go(k)).addTo(ctx.layer);
    });
  }

  function speak() {
    const synth = window.speechSynthesis; if (!synth) { ctx.toast('Read-aloud isn’t available in this browser'); return; }
    if (speaking) { synth.cancel(); speaking = false; render(); return; }
    const s = stops[i];
    const u = new SpeechSynthesisUtterance(`Stop ${i + 1}. ${s.title ?? s.b.name}. ${s.text} ${s.lookFor ? `Look for: ${s.lookFor}` : ''}`);
    u.onend = u.onerror = () => { speaking = false; render(); };
    synth.cancel(); synth.speak(u); speaking = true; render();
  }

  function render() {
    const s = stops[i], t = totals(), leg = legs[i - 1];
    ctx.el.innerHTML = `
      <div class="tour-head"><span class="pc-label">🎒 ${esc(TOUR.title)}</span>
        <button class="btn small" id="tourEnd">End tour</button></div>
      ${i === 0 ? `<p class="small">${esc(TOUR.intro)}</p>
        <p class="hint">${stops.length} stops · ${formatDistance(t.m, ctx.units())} · about ${formatMinutes(t.min)} of walking${stepFree ? ' · step-free' : ''}</p>` : ''}
      <ol class="tour-dots" aria-label="Tour progress">${stops.map((x, k) => `<li class="${k === i ? 'cur' : k < i ? 'done' : ''}"><button data-k="${k}" aria-label="Stop ${k + 1}: ${esc(x.title ?? x.b.name)}" ${k === i ? 'aria-current="step"' : ''}>${k + 1}</button></li>`).join('')}</ol>
      <article class="tour-stop" aria-live="polite">
        <span class="pc-label">Stop ${i + 1} of ${stops.length}</span>
        <h2>${esc(s.title ?? s.b.name)}</h2>
        ${leg ? `<span class="small muted">${formatMinutes(leg.minutes)} walk from the last stop</span>` : ''}
        <p>${esc(s.text)}</p>
        ${s.lookFor ? `<p class="look"><b>Look for:</b> ${esc(s.lookFor)}</p>` : ''}
      </article>
      <div class="btn-row">
        <button class="btn" id="tourPrev" ${i === 0 ? 'disabled' : ''}>◀ Previous</button>
        <button class="btn primary" id="tourNext">${i === stops.length - 1 ? 'Finish ✓' : 'Next stop ▶'}</button>
      </div>
      <div class="btn-row">
        <button class="btn small" id="tourSpeak">${speaking ? '■ Stop reading' : '🔊 Read aloud'}</button>
        <button class="btn small" id="tourDir">Directions to this stop</button>
        <button class="btn small" id="tourMore" data-b="${esc(s.b.id)}">About this building</button>
      </div>
      <label class="check"><input type="checkbox" id="tourAuto" ${auto ? 'checked' : ''}/> Use my location — open each stop as I arrive</label>
      <label class="check"><input type="checkbox" id="tourStepFree" ${stepFree ? 'checked' : ''}/> Step-free tour (avoids stairs)</label>`;
    const $ = (sel) => ctx.el.querySelector(sel);
    $('#tourEnd').onclick = end;
    $('#tourPrev').onclick = () => go(i - 1);
    $('#tourNext').onclick = () => (i === stops.length - 1 ? finish() : go(i + 1));
    $('#tourSpeak').onclick = speak;
    $('#tourDir').onclick = () => ctx.directionsTo(s.b.id);
    $('#tourAuto').onchange = (e) => { auto = e.target.checked; if (auto) ctx.startLocation(); };
    $('#tourStepFree').onchange = (e) => { stepFree = e.target.checked; save(); computeLegs(); draw(); render(); };
    ctx.el.querySelector('.tour-dots').onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k != null) go(+k); };
  }

  function go(k, { fly = true } = {}) {
    if (k < 0 || k >= stops.length) return;
    if (speaking) { window.speechSynthesis?.cancel(); speaking = false; }
    i = k; save(); draw(); render();
    if (fly) {
      const s = stops[i], leg = legs[i - 1];
      ctx.fitView(leg ? L.latLngBounds(leg.latlngs) : L.latLng(s.b.lat, s.b.lng).toBounds(120));
    }
  }
  function finish() { ctx.toast('🎉 Tour complete — thanks for visiting Towson!', 4000); i = 0; save(); end(); }
  function end() { window.speechSynthesis?.cancel(); speaking = false; auto = false; ctx.layer.clearLayers(); ctx.onExit(); }

  return {
    start(k = i) {
      computeLegs();
      if (!legs.some(Boolean)) ctx.toast('Couldn’t plan the tour route; showing the stops only');
      go(k, { fly: false });
      const all = stops.map((s) => [s.b.lat, s.b.lng]);
      ctx.fitView(L.latLngBounds(all));
    },
    /** GPS fix: open the next stop when the visitor reaches it. */
    position(p) {
      if (!auto || !stops.length) return;
      const nxt = stops[i + 1];
      if (nxt && distance(p, nxt.b) < ARRIVE_M) { go(i + 1); ctx.toast(`📍 Stop ${i + 1}: ${nxt.title ?? nxt.b.name}`); }
    },
    get index() { return i; },
    stops,
  };
}
