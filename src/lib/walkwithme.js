// Walk With Me: share a walk with a friend, with a safety timer.
//
// The walker's app runs a WalkSession. If they haven't arrived a few minutes
// after the expected time it asks "Are you OK?"; no answer within a minute
// raises an alert (call TU Police / text your friend). Messages go to the
// friend's screen through a transport: live across devices when cloud
// accounts (Supabase) are set up, otherwise the friend sees the planned walk
// and expected arrival time from the shared link.

import { distance } from './geo.js';

// Towson University Police (towson.edu/public-safety/police/contact)
export const TUPD = {
  emergency: { label: 'TU Police emergency', tel: '410-704-4444' },
  escort: { label: 'SafeWalk escort (free)', tel: '410-704-7233' },
  nonEmergency: { label: 'TU Police non-emergency', tel: '410-704-2134' },
};

export const ARRIVE_METERS = 30;
export const CHECKIN_SECONDS = 60;

export const newWalkId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);

/** Link a friend opens to follow the walk. */
export function watchLink(base, { id, name, from, to, eta }) {
  const p = new URLSearchParams({ watch: id, name, from, to, eta: String(Math.round(eta / 1000)) });
  return `${base}#${p}`;
}
export function parseWatch(params) {
  if (!params.get('watch')) return null;
  return { id: params.get('watch'), name: params.get('name') || 'Your friend', from: params.get('from'), to: params.get('to'), eta: +params.get('eta') * 1000 };
}

export class WalkSession {
  /** opts: { id, name, fromLabel, toLabel, dest: {lat,lng}, eta (ms), bufferMin, transport, now } */
  constructor(opts) {
    Object.assign(this, { bufferMin: 5, ...opts });
    this.state = 'walking';
    this.lastSent = 0;
    this.checkinUntil = null;
  }
  get deadline() { return this.eta + this.bufferMin * 60000; }
  #send(type, extra = {}, t = Date.now()) { this.transport?.send({ type, id: this.id, t, ...extra }); }

  start(t = Date.now()) {
    this.#send('start', { name: this.name, fromLabel: this.fromLabel, toLabel: this.toLabel, eta: this.eta }, t);
    return this;
  }
  /** New GPS fix. Returns 'arrived' when the walker reaches the destination. */
  position(p, t = Date.now()) {
    if (this.state === 'ended' || this.state === 'arrived') return null;
    if (t - this.lastSent >= 10000) { this.#send('pos', { lat: p.lat, lng: p.lng, acc: p.acc }, t); this.lastSent = t; }
    if (distance(p, this.dest) <= ARRIVE_METERS) { this.state = 'arrived'; this.#send('arrived', {}, t); return 'arrived'; }
    return null;
  }
  /** Call every few seconds. Returns 'checkin' or 'alert' when the state changes. */
  tick(t = Date.now()) {
    if (this.state === 'walking' && t > this.deadline) {
      this.state = 'checkin'; this.checkinUntil = t + CHECKIN_SECONDS * 1000;
      this.#send('checkin', {}, t);
      return 'checkin';
    }
    if (this.state === 'checkin' && t > this.checkinUntil) { this.state = 'alert'; this.#send('alert', { reason: 'no-response' }, t); return 'alert'; }
    return null;
  }
  /** "I'm OK" — extends the expected arrival time. */
  ok(extraMin = 5, t = Date.now()) {
    if (this.state === 'arrived' || this.state === 'ended') return;
    this.state = 'walking'; this.checkinUntil = null;
    this.eta = Math.max(this.eta, t) + extraMin * 60000;
    this.#send('ok', { eta: this.eta }, t);
  }
  sos(t = Date.now()) { this.state = 'alert'; this.#send('alert', { reason: 'sos' }, t); }
  end(t = Date.now()) { if (this.state !== 'arrived') this.#send('ended', {}, t); this.state = 'ended'; this.transport?.close?.(); }
}

/** Friend's view: fold incoming messages into what to show. */
export function watchReducer(state, msg) {
  const s = { ...state, updatedAt: msg.t ?? state.updatedAt };
  switch (msg.type) {
    case 'start': return { ...s, status: 'walking', name: msg.name ?? s.name, fromLabel: msg.fromLabel, toLabel: msg.toLabel, eta: msg.eta, live: true };
    case 'pos': return { ...s, pos: { lat: msg.lat, lng: msg.lng, acc: msg.acc }, live: true, status: s.status === 'checkin' ? 'checkin' : s.status ?? 'walking' };
    case 'ok': return { ...s, status: 'walking', eta: msg.eta };
    case 'checkin': return { ...s, status: 'checkin' };
    case 'alert': return { ...s, status: 'alert', reason: msg.reason };
    case 'arrived': return { ...s, status: 'arrived' };
    case 'ended': return { ...s, status: 'ended' };
    default: return state;
  }
}
/** True if a live walk hasn't sent anything for a while (phone off, no signal). */
export const isStale = (state, now = Date.now()) => !!state.live && ['walking', 'checkin'].includes(state.status) && now - state.updatedAt > 120000;
