// Student accounts.
//
// Two interchangeable backends:
//   LocalBackend    — accounts live on this device (works with no server).
//                     Passwords are salted + hashed with PBKDF2, never stored.
//   SupabaseBackend — real cloud accounts that sync across devices. Enabled
//                     when SUPABASE_URL / SUPABASE_ANON_KEY are set in src/config.js.
//
// Everything a student owns (schedule, favorites, goals, activity, reminder
// settings) is one JSON "user data" document, loaded on sign-in and saved on change.

import { DEFAULT_GOALS } from './activity.js';

export const defaultData = () => ({
  favs: [], recent: [], schedule: [],
  goals: { ...DEFAULT_GOALS },
  settings: { leadMinutes: 10, addWalkTime: true, notifications: false, heightCm: null, strictAccess: false, term: null },
  activity: {},
});

/** Fill in fields added in newer versions without losing anything. */
export function normalizeData(d) {
  const base = defaultData();
  return { ...base, ...d, goals: { ...base.goals, ...d?.goals }, settings: { ...base.settings, ...d?.settings } };
}

export const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export function validateSignUp({ name, email, password }) {
  if (!name?.trim()) return 'Enter your name.';
  if (!validateEmail(email ?? '')) return 'Enter a valid email address.';
  if ((password ?? '').length < 8) return 'Password must be at least 8 characters.';
  return null;
}

// ---------------------------------------------------------------- on-device backend
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(password, salt, iterations = 210000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64(bits);
}

export class LocalBackend {
  kind = 'local';
  constructor(storage = globalThis.localStorage) { this.s = storage; }
  #get(k, d) { try { return JSON.parse(this.s.getItem(k)) ?? d; } catch { return d; } }
  #set(k, v) { this.s.setItem(k, JSON.stringify(v)); }
  #users() { return this.#get('tigerpath.accounts', {}); }

  async restore() {
    const id = this.#get('tigerpath.session', null);
    const u = Object.values(this.#users()).find((x) => x.id === id);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  }
  async signUp({ name, email, password }) {
    const err = validateSignUp({ name, email, password }); if (err) throw new Error(err);
    const users = this.#users();
    const key = email.trim().toLowerCase();
    if (users[key]) throw new Error('An account with that email already exists on this device. Sign in instead.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const id = crypto.randomUUID();
    users[key] = { id, name: name.trim(), email: key, salt: b64(salt), hash: await hashPassword(password, salt), created: new Date().toISOString() };
    this.#set('tigerpath.accounts', users);
    this.#set('tigerpath.session', id);
    return { id, name: name.trim(), email: key };
  }
  async signIn({ email, password }) {
    const u = this.#users()[(email ?? '').trim().toLowerCase()];
    if (!u || (await hashPassword(password ?? '', unb64(u.salt))) !== u.hash) throw new Error('Email or password is incorrect.');
    this.#set('tigerpath.session', u.id);
    return { id: u.id, name: u.name, email: u.email };
  }
  async signOut() { this.s.removeItem('tigerpath.session'); }
  async load(user) { return this.#get(`tigerpath.user.${user.id}`, null); }
  async save(user, data) { this.#set(`tigerpath.user.${user.id}`, data); }
  async deleteAccount(user) {
    const users = this.#users();
    delete users[user.email];
    this.#set('tigerpath.accounts', users);
    this.s.removeItem(`tigerpath.user.${user.id}`);
    await this.signOut();
  }
}

// ---------------------------------------------------------------- cloud backend
/** Table: user_data (id uuid primary key references auth.users, data jsonb, updated_at timestamptz). See supabase/schema.sql. */
export class SupabaseBackend {
  kind = 'cloud';
  constructor(client) { this.c = client; }
  #user(u) { return u && { id: u.id, email: u.email, name: u.user_metadata?.name ?? u.email.split('@')[0] }; }
  async restore() { const { data } = await this.c.auth.getSession(); return this.#user(data.session?.user); }
  async signUp({ name, email, password }) {
    const err = validateSignUp({ name, email, password }); if (err) throw new Error(err);
    const { data, error } = await this.c.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
    if (error) throw new Error(error.message);
    if (!data.session) return { needsConfirmation: true, email: email.trim() };
    return this.#user(data.user);
  }
  async signIn({ email, password }) {
    const { data, error } = await this.c.auth.signInWithPassword({ email: (email ?? '').trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    return this.#user(data.user);
  }
  async signOut() { await this.c.auth.signOut(); }
  async load(user) {
    const { data, error } = await this.c.from('user_data').select('data').eq('id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.data ?? null;
  }
  async save(user, d) {
    const { error } = await this.c.from('user_data').upsert({ id: user.id, data: d, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
  /** Hall Cup: this student's steps for a week (only hall + steps are shared, as an anonymous hall total). */
  async submitWeek(user, { week, hall, steps }) {
    const { error } = await this.c.from('weekly_steps').upsert({ user_id: user.id, week, hall, steps: Math.max(0, Math.min(250000, Math.round(steps))), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
  async withdrawWeek(user, week) { await this.c.from('weekly_steps').delete().eq('user_id', user.id).eq('week', week); }
  async leaderboard(week) {
    const { data, error } = await this.c.rpc('hall_leaderboard', { p_week: week });
    if (error) throw new Error(error.message);
    return data;
  }
  async deleteAccount(user) {
    // Deletes the student's data. Removing the login itself needs the service key (Supabase dashboard).
    await this.c.from('weekly_steps').delete().eq('user_id', user.id);
    await this.c.from('user_data').delete().eq('id', user.id);
    await this.signOut();
  }
}

// ---------------------------------------------------------------- service
const GUEST_KEY = 'tigerpath.guest';

/**
 * Holds the signed-in user (or guest) and their data. Guests' data lives on the
 * device; when a guest creates an account their schedule, favorites and
 * activity come with them.
 */
export class AccountService {
  constructor(backend, storage = globalThis.localStorage) {
    this.backend = backend; this.s = storage;
    this.user = null; this.data = defaultData();
    this.listeners = new Set(); this.saveTimer = null; this.lastError = null;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit() { this.listeners.forEach((fn) => fn(this)); }
  #guest() {
    try { const g = JSON.parse(this.s.getItem(GUEST_KEY)); if (g) return normalizeData(g); } catch { /* fall through */ }
    // migrate data saved by earlier versions (before accounts existed)
    const old = (k, d) => { try { return JSON.parse(this.s.getItem(k)) ?? d; } catch { return d; } };
    return normalizeData({ schedule: old('tigerpath.schedule.v1', []), favs: old('tigerpath.favs', []), recent: old('tigerpath.recent', []) });
  }
  async init() {
    try { this.user = await this.backend.restore(); } catch (e) { this.lastError = e.message; this.user = null; }
    this.data = this.user ? normalizeData((await this.backend.load(this.user).catch(() => null)) ?? {}) : this.#guest();
    this.#emit();
    return this.user;
  }
  async signUp(fields) {
    const res = await this.backend.signUp(fields);
    if (res.needsConfirmation) return res;
    const guest = this.#guest();
    this.user = res;
    this.data = normalizeData({ ...guest, settings: { ...guest.settings, heightCm: fields.heightCm ?? guest.settings.heightCm } });
    await this.backend.save(this.user, this.data);
    this.#emit();
    return res;
  }
  async signIn(fields) {
    this.user = await this.backend.signIn(fields);
    const saved = await this.backend.load(this.user);
    const guest = this.#guest();
    this.data = normalizeData(saved ?? {});
    if (!this.data.schedule.length && guest.schedule.length) this.data.schedule = guest.schedule; // bring guest classes along
    this.#emit();
    return this.user;
  }
  async signOut() {
    await this.flush();
    await this.backend.signOut();
    this.user = null; this.data = this.#guest();
    this.#emit();
  }
  async deleteAccount() {
    clearTimeout(this.saveTimer);
    await this.backend.deleteAccount(this.user);
    this.user = null; this.data = this.#guest();
    this.#emit();
  }
  /** Change data via a function; saves shortly after (debounced). */
  update(fn) {
    fn(this.data);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
    this.#emit();
  }
  async flush() {
    clearTimeout(this.saveTimer);
    try {
      if (this.user) await this.backend.save(this.user, this.data);
      else this.s.setItem(GUEST_KEY, JSON.stringify(this.data));
      this.lastError = null;
    } catch (e) { this.lastError = e.message; }
  }
}
