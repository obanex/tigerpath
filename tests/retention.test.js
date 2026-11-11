import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordVisit, weekKey, weekDays, weeklyChallenges, weekStats, challengeProgress, lifetimeStats, newBadges, BADGES } from '../src/lib/challenges.js';
import { addActivity, dayKey } from '../src/lib/activity.js';
import { describeCode, weatherAdvice, getWeather, formatTemp } from '../src/lib/weather.js';
import { WalkSession, watchReducer, watchLink, parseWatch, isStale, TUPD } from '../src/lib/walkwithme.js';
import { BUILDINGS } from '../src/data/buildings.js';

class Mem { m = new Map(); getItem(k) { return this.m.get(k) ?? null; } setItem(k, v) { this.m.set(k, v); } }

test('weeks', () => {
  assert.equal(weekKey(new Date(2026, 10, 11)), '2026-W46');
  assert.equal(weekKey(new Date(2027, 0, 1)), '2026-W53'); // Friday Jan 1 2027 belongs to 2026's last week
  const days = weekDays(new Date(2026, 10, 11)); // Wednesday
  assert.deepEqual([days[0], days[6]], ['2026-11-09', '2026-11-15']);
});

test('weekly challenges are stable per week, distinct, and track progress', () => {
  const goals = { steps: 7500, miles: 3 };
  const a = weeklyChallenges('2026-W46', goals), b = weeklyChallenges('2026-W46', goals);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((c) => c.id)).size, 3);
  const sets = new Set(['2026-W46', '2026-W47', '2026-W48', '2026-W49', '2026-W50'].map((w) => weeklyChallenges(w, goals).map((c) => c.id).sort().join()));
  assert.ok(sets.size >= 3, `challenges should vary week to week, got ${sets.size} distinct sets`);
  const data = { goals, activity: {}, visits: {} };
  const wed = new Date(2026, 10, 11, 12);
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) data.activity = addActivity(data.activity, d, { meters: 6000, campusMeters: 4000, steps: 8000 });
  data.activity = addActivity(data.activity, '2026-11-02', { meters: 9000, steps: 12000 }); // last week: not counted
  recordVisit(data, 'LA', new Date(2026, 10, 10)); recordVisit(data, 'CK', new Date(2026, 10, 11)); recordVisit(data, 'CK', new Date(2026, 10, 11));
  const st = weekStats(data, wed);
  assert.deepEqual({ ...st, campusMiles: Math.round(st.campusMiles * 10) / 10 }, { weekSteps: 24000, goalDays: 3, campusMiles: 7.5, newPlaces: 2, distinctPlaces: 2, activeDays: 3 });
  const prog = challengeProgress([{ id: 'goal-days', target: 4, metric: 'goalDays' }, { id: 'week-steps', target: 20000, metric: 'weekSteps' }], st);
  assert.deepEqual(prog.map((p) => [p.done, Math.round(p.pct * 100)]), [[false, 75], [true, 100]]);
  assert.equal(data.visits.CK.days, 1);
});

test('badges', () => {
  const data = { goals: { steps: 1000, miles: 1 }, activity: {}, visits: {}, badges: {} };
  assert.deepEqual(newBadges(data, BUILDINGS), []);
  for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) data.activity = addActivity(data.activity, d, { meters: 2000, steps: 2500 });
  for (const id of ['NDH', 'GDH', 'WVC', 'LA', 'CK']) recordVisit(data, id);
  const got = newBadges(data, BUILDINGS);
  for (const id of ['first-steps', 'goal-getter', 'streak-3', 'explorer-5', 'foodie']) assert.ok(got.includes(id), `${id} in ${got}`);
  assert.ok(!got.includes('streak-7'));
  data.badges = Object.fromEntries(got.map((id) => [id, '2026-11-10']));
  assert.deepEqual(newBadges(data, BUILDINGS), []); // nothing twice
  assert.equal(lifetimeStats(data, BUILDINGS).bestStreak, 3);
  assert.equal(BADGES.length, new Set(BADGES.map((b) => b.id)).size);
});

test('weather: codes, advice, cache', async () => {
  assert.equal(describeCode(61).label, 'Rain');
  assert.equal(weatherAdvice({ tempF: 31, code: 61, precip: 0.5, windMph: 5 }).icy, true);
  assert.equal(weatherAdvice({ tempF: 60, code: 61, precip: 1, windMph: 5 }).icy, false);
  assert.equal(weatherAdvice({ tempF: 60, code: 0, precip: 0, windMph: 5 }).tip, null);
  assert.equal(formatTemp(50, 'metric'), '10°C');
  let calls = 0; const storage = new Mem();
  const fetchFn = async (url) => { calls++; assert.match(url, /latitude=39\.3925/); return { ok: true, json: async () => ({ current: { temperature_2m: 48.6, weather_code: 3, precipitation: 0, wind_speed_10m: 7, is_day: 1, time: 'x' } }) }; };
  const w = await getWeather({ fetchFn, storage, now: 1000 });
  assert.deepEqual([w.tempF, w.code, w.isDay], [49, 3, true]);
  await getWeather({ fetchFn, storage, now: 1000 + 60000 });
  assert.equal(calls, 1); // cached
  await getWeather({ fetchFn, storage, now: 1000 + 21 * 60000 });
  assert.equal(calls, 2);
});

test('Walk With Me: arrival, check-in, alert, ok, friend view', () => {
  const sent = [];
  const transport = { send: (m) => sent.push(m), close() {} };
  const t0 = Date.UTC(2026, 10, 11, 22, 0);
  const s = new WalkSession({ id: 'abc', name: 'Sam', fromLabel: 'Cook Library', toLabel: 'Glen Towers', dest: { lat: 39.3922, lng: -76.6101 }, eta: t0 + 8 * 60000, transport }).start(t0);
  assert.equal(s.position({ lat: 39.3936, lng: -76.6067 }, t0 + 1000), null);
  assert.equal(s.tick(t0 + 12 * 60000), null); // within eta + 5 min
  assert.equal(s.tick(t0 + 14 * 60000), 'checkin');
  s.ok(5, t0 + 14 * 60000 + 5000);
  assert.equal(s.state, 'walking');
  assert.equal(s.tick(t0 + 20 * 60000), null); // new eta 19:05 + 5 buffer
  assert.equal(s.tick(t0 + 25 * 60000), 'checkin');
  assert.equal(s.tick(t0 + 25 * 60000 + 61000), 'alert');
  const s2 = new WalkSession({ id: 'd', dest: { lat: 39.3922, lng: -76.6101 }, eta: t0 + 600000, transport });
  assert.equal(s2.position({ lat: 39.39222, lng: -76.61012 }, t0), 'arrived');
  // friend's screen
  let view = { status: 'planned', name: 'Sam', updatedAt: t0 };
  for (const m of sent.filter((m) => m.id === 'abc')) view = watchReducer(view, m);
  assert.equal(view.status, 'alert'); assert.equal(view.reason, 'no-response'); assert.ok(view.pos && view.live);
  assert.equal(isStale({ live: true, status: 'walking', updatedAt: t0 }, t0 + 3 * 60000), true);
  // share link round trip
  const link = watchLink('https://x.test/tigerpath/', { id: 'abc', name: 'Sam T', from: 'CK', to: 'GT', eta: t0 });
  const back = parseWatch(new URLSearchParams(link.split('#')[1]));
  assert.deepEqual(back, { id: 'abc', name: 'Sam T', from: 'CK', to: 'GT', eta: t0 });
  assert.equal(TUPD.emergency.tel, '410-704-4444');
});

test('Hall Cup ranking: by average, 3+ walkers, mine flagged', async () => {
  const { rankRows, teamOptions } = await import('../src/lib/leaderboard.js');
  const rows = [
    { hall: 'GT', walkers: 12, total_steps: '480000', avg_steps: 40000 },
    { hall: 'WV1', walkers: 4, total_steps: '200000', avg_steps: 50000 },
    { hall: 'RT', walkers: 2, total_steps: null, avg_steps: null },
    { hall: 'COMMUTE', walkers: 30, total_steps: '900000', avg_steps: 30000 },
  ];
  const ranked = rankRows(rows.sort((a, b) => (b.avg_steps ?? -1) - (a.avg_steps ?? -1)), { names: { GT: 'Glen Towers' }, mine: 'GT' });
  assert.deepEqual(ranked.map((r) => [r.hall, r.rank, r.needs]), [['WV1', 1, 0], ['GT', 2, 0], ['COMMUTE', 3, 0], ['RT', null, 1]]);
  assert.equal(ranked[1].name, 'Glen Towers'); assert.equal(ranked[1].mine, true);
  const teams = teamOptions(BUILDINGS);
  assert.equal(teams.at(-1).id, 'COMMUTE');
  assert.ok(teams.every((t) => t.id === 'COMMUTE' || BUILDINGS.find((b) => b.id === t.id).category === 'residence'));
});

test('cloud backend: Hall Cup submit and leaderboard (mock client)', async () => {
  const { SupabaseBackend } = await import('../src/lib/account.js');
  const calls = [];
  const client = { from: (t) => ({ upsert: async (row) => { calls.push([t, row]); return { error: null }; } }), rpc: async (fn, args) => { calls.push([fn, args]); return { data: [{ hall: 'GT', walkers: 3, total_steps: 9, avg_steps: 3 }], error: null }; } };
  const be = new SupabaseBackend(client);
  await be.submitWeek({ id: 'u1' }, { week: '2026-W46', hall: 'GT', steps: 999999.6 });
  assert.deepEqual(calls[0][0], 'weekly_steps'); assert.equal(calls[0][1].steps, 250000); assert.equal(calls[0][1].user_id, 'u1');
  assert.equal((await be.leaderboard('2026-W46'))[0].hall, 'GT');
  assert.deepEqual(calls[1], ['hall_leaderboard', { p_week: '2026-W46' }]);
});
