// Walk With Me — the walker's screens and the friend's "following" view.

import { shareBase } from '../native.js';
import L from 'leaflet';
import { WalkSession, watchReducer, isStale, watchLink, newWalkId, TUPD } from '../lib/walkwithme.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const telLink = (n) => `tel:${n.replace(/[^0-9+]/g, '')}`;

/** Messages between walker and friend: same-device tabs always; across devices via Supabase Realtime when configured. */
export function createTransport(id, supabaseClient) {
  const listeners = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`tigerpath-walk-${id}`) : null;
  if (bc) bc.onmessage = (e) => listeners.forEach((f) => f(e.data));
  let ch = null;
  if (supabaseClient) {
    ch = supabaseClient.channel(`walk-${id}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => listeners.forEach((f) => f(payload)));
    ch.subscribe();
  }
  return {
    cloud: !!ch,
    send(m) { bc?.postMessage(m); ch?.send({ type: 'broadcast', event: 'msg', payload: m }); },
    onMessage(f) { listeners.add(f); },
    close() { bc?.close(); if (ch) supabaseClient.removeChannel(ch); },
  };
}

/** Emergency buttons. Walker: call / text their location. Friend (watcher): call / open the walker's last location. */
function emergencyHtml(pos, { watcher = false, name = '' } = {}) {
  const where = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : '';
  const sms = `sms:?&body=${encodeURIComponent(`I need help.${where ? ` I'm here: ${where}` : ''}`)}`;
  return `<div class="sos-list">
    <a class="btn sos" href="${telLink(TUPD.emergency.tel)}">📞 Call TU Police · ${TUPD.emergency.tel}</a>
    <a class="btn sos" href="tel:911">📞 Call 911</a>
    ${watcher
      ? (where ? `<a class="btn" href="${where}" target="_blank" rel="noopener">📍 Open ${esc(name)}'s last location</a>` : '')
      : `<a class="btn" href="${sms}">💬 Text a friend my location</a>
         <a class="btn" href="${telLink(TUPD.escort.tel)}">🚶 Request a SafeWalk escort · ${TUPD.escort.tel}</a>`}
  </div>`;
}

/**
 * Walker side. ctx: { acc, toast, getRoute(), getMe(), ensureLive(), stopLive(), supabaseClient, onArrived() }
 */
export function createWalkWithMe(ctx) {
  const bar = document.getElementById('walkBar');
  const dlg = document.getElementById('walkDialog');
  let session = null, timer = null;

  const showDialog = (html) => { dlg.innerHTML = `<div class="walk-card" role="document">${html}</div>`; dlg.hidden = false; };
  const closeDialog = () => { dlg.hidden = true; dlg.innerHTML = ''; };
  const vibrate = () => navigator.vibrate?.([300, 150, 300]);
  const notify = async (title, body) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { (await navigator.serviceWorker?.getRegistration())?.showNotification(title, { body, tag: 'walk', requireInteraction: true, icon: 'icon.svg' }); } catch { /* ignore */ }
  };

  function renderBar() {
    if (!session) { bar.hidden = true; return; }
    const late = session.state === 'checkin' || session.state === 'alert';
    bar.className = late ? 'alert' : '';
    bar.innerHTML = `<span>🛡️ <b>Walk With Me</b> · to ${esc(session.toLabel)} · arrive by ${hm(session.eta)}</span>
      <span class="btn-row"><button class="btn small" id="wwmSafe">I'm safe — end</button><button class="btn small sos" id="wwmHelp">🚨 Help</button></span>`;
    bar.hidden = false;
    bar.querySelector('#wwmSafe').onclick = () => finish('ended');
    bar.querySelector('#wwmHelp').onclick = () => { session.sos(); alertPanel('sos'); renderBar(); };
  }

  function checkinPanel() {
    vibrate(); notify('Are you OK?', `You haven't reached ${session.toLabel} yet. Tap to check in.`);
    const until = session.checkinUntil;
    showDialog(`<h2>Are you OK?</h2><p>You haven't reached <b>${esc(session.toLabel)}</b> yet.</p>
      <p class="countdown" id="wwmCount"></p>
      <div class="btn-row"><button class="btn primary" id="wwmOk">I'm OK — 5 more minutes</button><button class="btn sos" id="wwmNeed">I need help</button></div>`);
    const count = dlg.querySelector('#wwmCount');
    const upd = () => { const s = Math.max(0, Math.round((until - Date.now()) / 1000)); count.textContent = `If you don't answer in ${s}s, we'll show emergency options.`; };
    upd(); const iv = setInterval(() => { if (dlg.hidden || !dlg.querySelector('#wwmCount')) clearInterval(iv); else upd(); }, 1000);
    dlg.querySelector('#wwmOk').onclick = () => { session.ok(5); closeDialog(); renderBar(); ctx.toast(`OK — new arrival time ${hm(session.eta)}`); };
    dlg.querySelector('#wwmNeed').onclick = () => { session.sos(); alertPanel('sos'); renderBar(); };
  }

  function alertPanel(reason) {
    vibrate(); notify('Walk With Me', 'Emergency options are open.');
    showDialog(`<h2>${reason === 'sos' ? 'Get help now' : 'No check-in — are you safe?'}</h2>
      <p>${session.transport?.cloud ? 'Your friend has been alerted on their screen.' : 'Call or text someone now.'}</p>
      ${emergencyHtml(ctx.getMe())}
      <div class="btn-row"><button class="btn" id="wwmFalse">I'm safe now — keep walking</button></div>`);
    dlg.querySelector('#wwmFalse').onclick = () => { session.ok(5); closeDialog(); renderBar(); };
  }

  function finish(how) {
    if (!session) return;
    const s = session;
    clearInterval(timer); timer = null;
    if (how === 'arrived') {
      ctx.acc.update((d) => { d.safeWalks = (d.safeWalks ?? 0) + 1; });
      const text = `I made it to ${s.toLabel} ✓ (TigerPath Walk With Me)`;
      showDialog(`<h2>You made it 🎉</h2><p>You arrived at <b>${esc(s.toLabel)}</b>.</p>
        <div class="btn-row"><button class="btn primary" id="wwmTell">Let them know</button><button class="btn" id="wwmClose">Done</button></div>`);
      dlg.querySelector('#wwmTell').onclick = async () => {
        if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } }
        else { try { await navigator.clipboard.writeText(text); ctx.toast('Copied — paste it to your friend'); } catch { /* ignore */ } }
        closeDialog();
      };
      dlg.querySelector('#wwmClose').onclick = closeDialog;
      ctx.onArrived?.();
    } else closeDialog();
    s.end();
    session = null;
    renderBar();
    ctx.stopLive?.();
  }

  return {
    get active() { return !!session; },
    /** Open the start sheet for the current route. */
    open() {
      const r = ctx.getRoute();
      if (!r?.res) { ctx.toast('Pick a destination first'); return; }
      const id = newWalkId();
      const eta = Date.now() + Math.ceil(r.minutes) * 60000;
      const name = ctx.acc.user?.name?.split(' ')[0] ?? 'Your friend';
      const link = watchLink(shareBase(), { id, name, from: r.fromCode, to: r.toCode, eta });
      const msg = `I'm walking to ${r.b.label} — should arrive by ${hm(eta)}. Follow along: ${link}`;
      showDialog(`<h2>🛡️ Walk With Me</h2>
        <p>Share your walk to <b>${esc(r.b.label)}</b> with a friend. Expected arrival <b>${hm(eta)}</b>.</p>
        <ul class="perks small"><li>⏱️ If you're more than 5 minutes late, we'll check you're OK.</li>
          <li>🚨 No answer within a minute brings up TU Police and text-a-friend buttons.</li>
          <li>📍 ${ctx.supabaseClient ? 'Your friend sees your live location until you arrive.' : 'Your friend sees your planned route and arrival time.'}</li></ul>
        <div class="btn-row"><button class="btn" id="wwmShare">Share with a friend</button><a class="btn" id="wwmSms" href="sms:?&body=${encodeURIComponent(msg)}">Text it</a></div>
        <div class="btn-row"><button class="btn primary wide" id="wwmStart">Start walking</button></div>
        <button class="link-btn" id="wwmCancel">Cancel</button>`);
      dlg.querySelector('#wwmShare').onclick = async () => {
        if (navigator.share) { try { await navigator.share({ title: 'Walk With Me', text: msg }); } catch { /* cancelled */ } }
        else { try { await navigator.clipboard.writeText(msg); ctx.toast('Link copied — send it to your friend'); } catch { prompt('Copy and send this to a friend', msg); } }
      };
      dlg.querySelector('#wwmCancel').onclick = closeDialog;
      dlg.querySelector('#wwmStart').onclick = async () => {
        if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
        const transport = createTransport(id, ctx.supabaseClient);
        session = new WalkSession({ id, name, fromLabel: r.a.label, toLabel: r.b.label, dest: { lat: r.latlngs.at(-1)[0], lng: r.latlngs.at(-1)[1] }, eta, transport }).start();
        timer = setInterval(() => {
          const ev = session?.tick();
          if (ev === 'checkin') { checkinPanel(); renderBar(); }
          if (ev === 'alert') { alertPanel('no-response'); renderBar(); }
        }, 3000);
        closeDialog(); renderBar(); ctx.ensureLive?.();
        ctx.toast('Walk With Me is on. Stay safe!');
      };
    },
    position(p) { if (session?.position(p) === 'arrived') finish('arrived'); },
    end: () => finish('ended'),
  };
}

/**
 * Friend side: shown when the app is opened from a Walk With Me link.
 * ctx: { map, watch: {id,name,from,to,eta}, routeLatLngs, fromLabel, toLabel, supabaseClient }
 */
export function createWatchView(ctx) {
  const el = document.getElementById('watchPanel');
  const layer = L.layerGroup().addTo(ctx.map);
  let state = { status: 'planned', name: ctx.watch.name, eta: ctx.watch.eta, fromLabel: ctx.fromLabel, toLabel: ctx.toLabel, updatedAt: Date.now(), live: false };
  let marker = null;
  if (ctx.routeLatLngs?.length) {
    L.polyline(ctx.routeLatLngs, { color: '#fff', weight: 10 }).addTo(layer);
    L.polyline(ctx.routeLatLngs, { color: '#16a34a', weight: 6, dashArray: '8 8' }).addTo(layer);
    if (ctx.map.getSize().x) ctx.map.fitBounds(L.latLngBounds(ctx.routeLatLngs), { padding: [40, 40] });
  }
  const transport = createTransport(ctx.watch.id, ctx.supabaseClient);
  transport.onMessage((m) => { state = watchReducer(state, m); render(); });

  function render() {
    if (state.pos) {
      const ll = [state.pos.lat, state.pos.lng];
      if (!marker) marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="friend-dot"></div>', iconSize: [22, 22] }) }).addTo(layer);
      else marker.setLatLng(ll);
    }
    const stale = isStale(state);
    const late = state.status === 'walking' && Date.now() > state.eta + 5 * 60000;
    const head = {
      planned: `${esc(state.name)} is walking to ${esc(state.toLabel)}`,
      walking: `${esc(state.name)} is on the way to ${esc(state.toLabel)}`,
      checkin: `${esc(state.name)} is running late — checking in`,
      alert: `⚠️ ${esc(state.name)} may need help`,
      arrived: `✅ ${esc(state.name)} arrived at ${esc(state.toLabel)}`,
      ended: `${esc(state.name)} ended the walk`,
    }[state.status] ?? '';
    el.className = state.status === 'alert' || stale ? 'alert' : state.status === 'arrived' ? 'ok' : '';
    el.innerHTML = `<b>🛡️ ${head}</b>
      <div class="small">${state.status === 'arrived' ? '' : `Expected by ${hm(state.eta)}${late ? ' — running late' : ''}`}
      ${state.live ? (stale ? ' · ⚠️ no update for 2+ minutes' : ' · live') : ` · from ${esc(state.fromLabel)}`}</div>
      ${!state.live && state.status === 'planned' ? `<div class="small muted">The dashed line is their planned route. ${ctx.supabaseClient ? 'Their live location appears here once they start.' : 'Live location needs cloud accounts; they can message you when they arrive.'}</div>` : ''}
      ${state.status === 'alert' || stale ? emergencyHtml(state.pos, { watcher: true, name: state.name }) : ''}`;
    el.hidden = false;
  }
  render();
  setInterval(render, 15000);
  return { get state() { return state; } };
}
