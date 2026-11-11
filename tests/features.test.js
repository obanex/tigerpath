import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackAccumulator, StepDetector, addActivity, goalProgress, streak, lastDays, dayKey, stepsFromMeters, strideFromHeight } from '../src/lib/activity.js';
import { planReminders, dueReminders, upcomingClasses } from '../src/lib/reminders.js';
import { AccountService, LocalBackend, SupabaseBackend, validateSignUp } from '../src/lib/account.js';
import { toICS } from '../src/lib/schedule.js';

class MemStorage { m = new Map(); getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }

// ---------- activity
test('GPS accumulator: counts walking, ignores jitter, bad fixes and driving', () => {
  const t = new TrackAccumulator();
  const at = (lat, s, acc = 8) => ({ lat, lng: -76.61, acc, t: s * 1000 });
  t.add(at(39.3900, 0));
  t.add(at(39.39001, 5));             // ~1 m jitter: ignored
  t.add(at(39.3910, 90));             // ~111 m in 90 s: walking
  t.add(at(39.3920, 100, 80));        // inaccurate fix: ignored
  t.add(at(39.4100, 240));            // ~2 km in 2.5 min: driving, skipped
  t.add(at(39.4105, 280));            // walking again off campus from the new anchor (~56 m)
  assert.ok(Math.abs(t.meters - 167) < 3, `meters ${t.meters}`);
  assert.ok(Math.abs(t.campusMeters - 111) < 2, `campus ${t.campusMeters}`); // last segment is off campus
});

test('step detector counts a 2 steps/second walking rhythm', () => {
  const d = new StepDetector();
  for (let ms = 0; ms <= 10000; ms += 20) {
    const bounce = 3 * Math.max(0, Math.sin((2 * Math.PI * 2 * ms) / 1000)); // 2 Hz heel strikes
    d.push(0, 0, 9.81 + bounce + (Math.random() - 0.5) * 0.2, ms);
  }
  assert.ok(d.steps >= 17 && d.steps <= 21, `steps ${d.steps}`);
});

test('daily totals, goals, streaks', () => {
  assert.equal(stepsFromMeters(1609.344, strideFromHeight(175)), 2221);
  let a = {};
  const day = (n) => { const d = new Date(2026, 10, 11); d.setDate(d.getDate() - n); return dayKey(d); };
  for (const n of [1, 2, 3]) a = addActivity(a, day(n), { meters: 5000, steps: 8000 });
  a = addActivity(a, day(5), { meters: 5000, steps: 8000 });
  a = addActivity(a, day(0), { meters: 1000, steps: 1500 });
  a = addActivity(a, day(0), { meters: 500, steps: 700, seconds: 600 });
  assert.equal(a[day(0)].steps, 2200);
  const today = new Date(2026, 10, 11, 12);
  assert.equal(streak(a, { steps: 7500, miles: 3 }, today), 3); // today not met yet, so yesterday back
  assert.equal(goalProgress(a[day(1)], { steps: 7500, miles: 3 }).met, true);
  assert.deepEqual(lastDays(a, 7, today).map((d) => d.steps), [0, 8000, 0, 8000, 8000, 8000, 2200]);
});

// ---------- reminders
test('reminders: lead time, walking time from previous class, already-sent, term dates', () => {
  const classes = [
    { id: 'a', title: 'COSC 236', building: 'YR', days: ['mon', 'wed'], start: '09:00', end: '09:50' },
    { id: 'b', title: 'ENGL 102', building: 'LA', days: ['mon'], start: '10:00', end: '10:50' },
  ];
  const mon = new Date(2026, 10, 9, 7, 0); // Monday 7:00
  const plan = planReminders(classes, mon, { leadMinutes: 10, addWalkTime: true }, () => 6.2);
  assert.deepEqual(plan.map((r) => r.id), ['a@2026-11-09', 'b@2026-11-09']); // Wednesday is beyond the 36 h window
  assert.equal(plan[0].fireAt.toTimeString().slice(0, 5), '08:50');          // first class: just the lead time
  assert.equal(plan[1].leaveBy.toTimeString().slice(0, 5), '09:53');         // 10:00 − 7 min walk
  assert.equal(plan[1].fireAt.toTimeString().slice(0, 5), '09:43');          // leave-by − 10 min
  const at851 = new Date(2026, 10, 9, 8, 51);
  assert.deepEqual(dueReminders(plan, at851).map((r) => r.id), ['a@2026-11-09']);
  assert.deepEqual(dueReminders(plan, at851, new Set(['a@2026-11-09'])), []);
  assert.equal(upcomingClasses(classes, mon, 72, { start: '2026-11-10', end: '2026-12-31' })[0].day, '2026-11-11');
});

test('calendar export includes alarms', () => {
  const ics = toICS([{ id: '1', title: 'X', building: 'LA', days: ['mon'], start: '09:00', end: '09:50' }], { termStart: '2027-01-25', termEnd: '2027-05-14', alarmMinutes: 15 });
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:X starts in 15 min\r\nTRIGGER:-PT15M\r\nEND:VALARM/);
});

// ---------- accounts
test('local accounts: sign up, hashed password, sign in, guest data carried over, delete', async () => {
  const s = new MemStorage();
  s.setItem('tigerpath.schedule.v1', JSON.stringify([{ id: 'c1', title: 'Old class', building: 'LA', days: ['mon'], start: '09:00', end: '09:50' }]));
  const acc = new AccountService(new LocalBackend(s), s);
  await acc.init();
  assert.equal(acc.user, null);
  assert.equal(acc.data.schedule[0].title, 'Old class'); // migrated from the pre-accounts version
  await assert.rejects(acc.signUp({ name: 'Sam', email: 'bad', password: 'longenough' }), /valid email/);
  await acc.signUp({ name: 'Sam', email: 'Sam@Students.Towson.edu', password: 'tigers2026', heightCm: 170 });
  assert.equal(acc.user.email, 'sam@students.towson.edu');
  assert.equal(acc.data.schedule.length, 1);
  assert.equal(acc.data.settings.heightCm, 170);
  assert.ok(!s.getItem('tigerpath.accounts').includes('tigers2026'), 'password must not be stored');
  acc.update((d) => { d.goals.steps = 10000; }); await acc.flush();
  await acc.signOut();
  assert.equal(acc.user, null);
  await assert.rejects(acc.signIn({ email: 'sam@students.towson.edu', password: 'wrong-password' }), /incorrect/);
  await acc.signIn({ email: 'SAM@students.towson.edu', password: 'tigers2026' });
  assert.equal(acc.data.goals.steps, 10000);
  const again = new AccountService(new LocalBackend(s), s); await again.init();
  assert.equal(again.user.name, 'Sam'); // session restored
  await assert.rejects(new AccountService(new LocalBackend(s), s).signUp({ name: 'X', email: 'sam@students.towson.edu', password: '12345678' }), /already exists/);
  await again.deleteAccount();
  await assert.rejects(acc.signIn({ email: 'sam@students.towson.edu', password: 'tigers2026' }), /incorrect/);
});

test('cloud backend talks to Supabase as expected (mock client)', async () => {
  const rows = new Map(); let session = null; const calls = [];
  const client = {
    auth: {
      async getSession() { return { data: { session } }; },
      async signUp({ email, password, options }) { calls.push('signUp'); const user = { id: 'u1', email, user_metadata: options.data }; session = { user }; return { data: { user, session }, error: null }; },
      async signInWithPassword({ email, password }) { return password === 'goodpass1' ? (session = { user: { id: 'u1', email, user_metadata: { name: 'Ana' } } }, { data: { user: session.user }, error: null }) : { data: {}, error: { message: 'Invalid login credentials' } }; },
      async signOut() { session = null; },
    },
    from(table) {
      assert.equal(table, 'user_data');
      return {
        select() { return { eq(_, id) { return { async maybeSingle() { return { data: rows.has(id) ? { data: rows.get(id) } : null, error: null }; } }; } }; },
        async upsert(row) { rows.set(row.id, row.data); return { error: null }; },
        delete() { return { async eq(_, id) { rows.delete(id); return { error: null }; } }; },
      };
    },
  };
  const acc = new AccountService(new SupabaseBackend(client), new MemStorage());
  await acc.signUp({ name: 'Ana', email: 'ana@students.towson.edu', password: 'goodpass1' });
  assert.equal(acc.user.name, 'Ana');
  acc.update((d) => { d.goals.miles = 4; }); await acc.flush();
  assert.equal(rows.get('u1').goals.miles, 4);
  await acc.signOut();
  await assert.rejects(acc.signIn({ email: 'ana@students.towson.edu', password: 'nope' }), /incorrect/);
  await acc.signIn({ email: 'ana@students.towson.edu', password: 'goodpass1' });
  assert.equal(acc.data.goals.miles, 4);
  assert.equal(validateSignUp({ name: 'A', email: 'a@b.co', password: 'short' }), 'Password must be at least 8 characters.');
});
