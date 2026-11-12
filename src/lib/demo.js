// Demo mode (open TigerPath with ?demo): a sample freshman, "Jordan", with a
// class schedule, three weeks of walking, visited buildings, badges and a live
// Hall Cup, so the whole app can be shown without signing up.
//
// Nothing is saved: DemoBackend keeps everything in memory and never touches
// the cloud database or the visitor's own TigerPath data.

import { dayKey, DEFAULT_GOALS } from './activity.js';
import { weekKey } from './challenges.js';
import { newBadges } from './challenges.js';
import { COMMUTERS } from './leaderboard.js';

export const DEMO_USER = { id: 'demo', name: 'Jordan', email: 'jordan@demo.tigerpath' };
export const DEMO_HALL = 'GT';

/** Small seeded random generator, so the demo looks the same on every device. */
function rng(seed) {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function demoData(now = new Date(), buildings = []) {
  const r = rng(weekKey(now));
  const goals = { ...DEFAULT_GOALS, steps: 8000 };
  // three weeks of walking; the last six days all hit the goal (a streak to show off)
  const activity = {};
  for (let i = 21; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    let steps = Math.round((weekend ? 4200 : 7200) + r() * 4800);
    if (i <= 6 && i > 0) steps = Math.max(steps, 8400 + Math.round(r() * 2500));
    if (i === 0) steps = Math.round(steps * Math.min(1, Math.max(0.35, (now.getHours() - 7) / 12))); // today so far
    const meters = Math.round(steps * 0.74);
    activity[dayKey(d)] = { steps, meters, campusMeters: Math.round(meters * (0.6 + r() * 0.3)), seconds: Math.round(steps / 1.8) };
  }
  const visited = ['GT', 'GDH', 'UU', 'CK', 'LA', 'SC', 'LH', 'PY', 'WVC', 'BU', 'ES', 'HH', 'CA', 'YR'];
  const visits = {};
  visited.forEach((id, i) => {
    const first = new Date(now); first.setDate(first.getDate() - 20 + Math.floor(i * 1.3));
    const last = new Date(now); last.setDate(last.getDate() - (i % 4));
    visits[id] = { first: dayKey(first), last: dayKey(last), days: 2 + (i % 6) };
  });
  const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7);
  const data = {
    favs: ['CK', 'UU', 'SC'], recent: ['LA', 'SC', 'CK', 'GDH'],
    schedule: [
      { id: 'demo-engl', title: 'ENGL 102', building: 'LA', room: '2210', days: ['mon', 'wed', 'fri'], start: '09:00', end: '09:50' },
      { id: 'demo-math', title: 'MATH 115', building: 'YR', room: '125', days: ['mon', 'wed'], start: '10:00', end: '11:15' },
      { id: 'demo-cosc', title: 'COSC 175', building: 'YR', room: '205', days: ['mon', 'wed'], start: '13:00', end: '14:15' },
      { id: 'demo-psyc', title: 'PSYC 101', building: 'LH', room: '140', days: ['tue', 'thu'], start: '09:30', end: '10:45' },
      { id: 'demo-biol', title: 'BIOL 190', building: 'SC', room: '2410', days: ['tue', 'thu'], start: '11:00', end: '12:15' },
      { id: 'demo-fyex', title: 'Tiger First-Year Seminar', building: 'CK', room: '507', days: ['fri'], start: '11:00', end: '11:50' },
    ],
    goals,
    settings: { leadMinutes: 10, addWalkTime: true, notifications: false, heightCm: 170, strictAccess: false, term: null,
      hall: DEMO_HALL, hallCup: true, home: DEMO_HALL, preferredRoute: 'fastest', hallChecked: weekKey(lastWeek) },
    activity, visits,
    hallWins: [weekKey(lastWeek)], // Glen Towers won last week's Hall Cup
  };
  // badges already earned (so the demo doesn't open with a burst of "badge earned" pop-ups)
  data.badges = Object.fromEntries(newBadges(data, buildings).map((id) => [id, dayKey(now)]));
  return data;
}

/** Hall Cup rows for a week: [{ hall, walkers, total_steps, avg_steps }] — every hall, Glen Towers near the top. */
export function demoLeaderboard(week, halls, mine = null) {
  const r = rng(`board:${week}`);
  const rows = [...halls, COMMUTERS.id].map((hall) => {
    const walkers = hall === COMMUTERS.id ? 30 + Math.floor(r() * 25) : 3 + Math.floor(r() * 14);
    const avg = Math.round((hall === DEMO_HALL ? 44000 : 26000) + r() * 16000);
    return { hall, walkers, total_steps: avg * walkers };
  });
  if (mine) { const row = rows.find((x) => x.hall === mine.hall); if (row) { row.walkers++; row.total_steps += mine.steps; } }
  for (const row of rows) row.avg_steps = Math.round(row.total_steps / row.walkers);
  return rows.sort((a, b) => b.avg_steps - a.avg_steps); // like hall_leaderboard(): best average first
}

export class DemoBackend {
  kind = 'demo';
  constructor({ now = new Date(), buildings = [], halls = [] } = {}) {
    this.data = demoData(now, buildings);
    this.halls = halls;
    this.weeks = {};
  }
  async restore() { return DEMO_USER; }
  async load() { return structuredClone(this.data); }
  async save(_user, data) { this.data = structuredClone(data); } // memory only
  async signUp() { throw new Error('This is the demo. Exit the demo to create your own account.'); }
  async signIn() { throw new Error('This is the demo. Exit the demo to sign in.'); }
  async signOut() { /* the page reloads without ?demo */ }
  async deleteAccount() { /* nothing stored */ }
  async submitWeek(_user, { week, hall, steps }) { this.weeks[week] = { hall, steps }; }
  async myWeek(_user, week) { return this.weeks[week] ?? (this.data.hallWins?.includes(week) ? { hall: DEMO_HALL, steps: 52000 } : null); }
  async withdrawWeek(_user, week) { delete this.weeks[week]; }
  async leaderboard(week) { return demoLeaderboard(week, this.halls, this.weeks[week]); }
}
