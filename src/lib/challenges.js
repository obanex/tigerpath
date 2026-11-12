// Weekly challenges and badges — reasons to keep walking (and exploring)
// once you already know your way around.
//
// Inputs are the student's account data: daily activity totals, goals, and
// `visits` (buildings they've actually been to, detected by location).

import { dayKey, goalProgress, METERS_PER_MILE } from './activity.js';

// ---------------------------------------------------------------- visits
/** Record being at a building today. Returns true if it was the first visit ever. */
export function recordVisit(data, buildingId, date = new Date()) {
  data.visits ??= {};
  const today = dayKey(date);
  const v = data.visits[buildingId];
  if (!v) { data.visits[buildingId] = { first: today, last: today, days: 1 }; return true; }
  if (v.last !== today) { v.last = today; v.days++; }
  return false;
}

// ---------------------------------------------------------------- weeks
/** ISO week, e.g. '2026-W46' (weeks start Monday). */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}
/** The local dates (YYYY-MM-DD) of the week containing `date`, Monday first. */
export function weekDays(date = new Date()) {
  const d = new Date(date); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return dayKey(x); });
}

const roundTo = (n, step) => Math.max(step, Math.round(n / step) * step);
const POOL = [
  { id: 'week-steps', icon: '👟', title: (t) => `Walk ${t.toLocaleString()} steps this week`, target: (g) => roundTo(g.steps * 4, 1000), metric: 'weekSteps' },
  { id: 'goal-days', icon: '🎯', title: (t) => `Hit your daily goal on ${t} days`, target: () => 4, metric: 'goalDays' },
  { id: 'campus-miles', icon: '🐯', title: (t) => `Walk ${t} miles on campus`, target: (g) => Math.max(3, Math.round(g.miles * 2)), metric: 'campusMiles' },
  { id: 'new-places', icon: '🧭', title: (t) => `Visit ${t} buildings you've never been to`, target: () => 2, metric: 'newPlaces' },
  { id: 'many-places', icon: '🏛️', title: (t) => `Visit ${t} different buildings`, target: () => 8, metric: 'distinctPlaces' },
  { id: 'active-days', icon: '📅', title: (t) => `Walk with TigerPath on ${t} days`, target: () => 5, metric: 'activeDays' },
];

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Three challenges for the week, the same for everyone in that week. */
export function weeklyChallenges(week, goals) {
  const pool = [...POOL];
  const picked = [];
  let h = hash(week);
  while (picked.length < 3) { const i = h % pool.length; picked.push(pool.splice(i, 1)[0]); h = hash(String(h)); }
  return picked.map((c) => { const target = c.target(goals); return { id: c.id, icon: c.icon, title: c.title(target), target, metric: c.metric }; });
}

export function weekStats(data, date = new Date()) {
  const days = weekDays(date);
  const act = days.map((k) => data.activity?.[k]).filter(Boolean);
  const visits = Object.entries(data.visits ?? {});
  return {
    weekSteps: act.reduce((s, a) => s + a.steps, 0),
    goalDays: days.filter((k) => goalProgress(data.activity?.[k], data.goals).met).length,
    campusMiles: act.reduce((s, a) => s + (a.campusMeters ?? 0), 0) / METERS_PER_MILE,
    newPlaces: visits.filter(([, v]) => days.includes(v.first)).length,
    distinctPlaces: visits.filter(([, v]) => days.includes(v.last)).length,
    activeDays: act.filter((a) => a.steps > 0 || a.meters > 0).length,
  };
}

export function challengeProgress(challenges, stats) {
  return challenges.map((c) => {
    const value = stats[c.metric] ?? 0;
    return { ...c, value, pct: Math.min(1, value / c.target), done: value >= c.target };
  });
}

// ---------------------------------------------------------------- badges
export function lifetimeStats(data, buildings = []) {
  const days = Object.keys(data.activity ?? {}).sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    if (!goalProgress(data.activity[k], data.goals).met) { run = 0; prev = k; continue; }
    const consecutive = prev && (new Date(k) - new Date(prev)) / 864e5 === 1;
    run = consecutive && run ? run + 1 : 1; best = Math.max(best, run); prev = k;
  }
  const visited = new Set(Object.keys(data.visits ?? {}));
  const byCat = (cat) => buildings.filter((b) => b.category === cat).map((b) => b.id);
  return {
    totalMiles: days.reduce((s, k) => s + data.activity[k].meters, 0) / METERS_PER_MILE,
    totalSteps: days.reduce((s, k) => s + data.activity[k].steps, 0),
    goalDays: days.filter((k) => goalProgress(data.activity[k], data.goals).met).length,
    bestStreak: best,
    visited: visited.size,
    allBuildings: buildings.length,
    visitedAll: (ids) => ids.length > 0 && ids.every((id) => visited.has(id)),
    visitedCount: (ids) => ids.filter((id) => visited.has(id)).length,
    dining: byCat('dining'), residence: byCat('residence'), academic: byCat('academic'),
    challengeWeeks: Object.values(data.challengeLog ?? {}).filter((ids) => ids.length >= 3).length,
    safeWalks: data.safeWalks ?? 0,
    hallWins: (data.hallWins ?? []).length,
  };
}

export const BADGES = [
  { id: 'first-steps', icon: '👣', title: 'First steps', desc: 'Track your first walk', test: (s) => s.totalSteps > 0 },
  { id: 'goal-getter', icon: '🎯', title: 'Goal getter', desc: 'Hit your daily goal', test: (s) => s.goalDays >= 1 },
  { id: 'streak-3', icon: '🔥', title: 'Warming up', desc: '3-day goal streak', test: (s) => s.bestStreak >= 3 },
  { id: 'streak-7', icon: '🔥', title: 'On fire', desc: '7-day goal streak', test: (s) => s.bestStreak >= 7 },
  { id: 'streak-30', icon: '🏆', title: 'Unstoppable', desc: '30-day goal streak', test: (s) => s.bestStreak >= 30 },
  { id: 'miles-10', icon: '🥉', title: '10 miles', desc: 'Walk 10 miles in total', test: (s) => s.totalMiles >= 10 },
  { id: 'miles-50', icon: '🥈', title: '50 miles', desc: 'Walk 50 miles in total', test: (s) => s.totalMiles >= 50 },
  { id: 'miles-100', icon: '🥇', title: 'Century', desc: 'Walk 100 miles in total', test: (s) => s.totalMiles >= 100 },
  { id: 'explorer-5', icon: '🧭', title: 'Explorer', desc: 'Visit 5 campus buildings', test: (s) => s.visited >= 5 },
  { id: 'explorer-15', icon: '🗺️', title: 'Pathfinder', desc: 'Visit 15 campus buildings', test: (s) => s.visited >= 15 },
  { id: 'explorer-all', icon: '🐯', title: 'Tiger of Towson', desc: 'Visit every building on the map', test: (s) => s.allBuildings > 0 && s.visited >= s.allBuildings },
  { id: 'foodie', icon: '🍽️', title: 'Foodie', desc: 'Eat at every dining hall', test: (s) => s.visitedAll(s.dining) },
  { id: 'hall-hopper', icon: '🏠', title: 'Hall hopper', desc: 'Visit 5 residence halls', test: (s) => s.visitedCount(s.residence) >= 5 },
  { id: 'scholar', icon: '🎓', title: 'Scholar', desc: 'Visit 10 academic buildings', test: (s) => s.visitedCount(s.academic) >= 10 },
  { id: 'champion', icon: '🏅', title: 'Weekly champion', desc: 'Finish all 3 weekly challenges', test: (s) => s.challengeWeeks >= 1 },
  { id: 'buddy', icon: '🛡️', title: 'Buddy system', desc: 'Finish a Walk With Me walk', test: (s) => s.safeWalks >= 1 },
  { id: 'hall-champion', icon: '🏆', title: 'Hall champion', desc: "Be in the week's winning Hall Cup team", test: (s) => s.hallWins >= 1 },
  { id: 'hall-dynasty', icon: '👑', title: 'Dynasty', desc: 'Win the Hall Cup 3 times', test: (s) => s.hallWins >= 3 },
];

/** How far along each badge is, from the same numbers its test uses: { id: { have, need, unit } }. */
export function badgeProgress(data, buildings) {
  const s = lifetimeStats(data, buildings);
  const P = {
    'first-steps': [s.totalSteps > 0 ? 1 : 0, 1, 'walk'], 'goal-getter': [Math.min(s.goalDays, 1), 1, 'goal day'],
    'streak-3': [s.bestStreak, 3, 'days'], 'streak-7': [s.bestStreak, 7, 'days'], 'streak-30': [s.bestStreak, 30, 'days'],
    'miles-10': [s.totalMiles, 10, 'miles'], 'miles-50': [s.totalMiles, 50, 'miles'], 'miles-100': [s.totalMiles, 100, 'miles'],
    'explorer-5': [s.visited, 5, 'buildings'], 'explorer-15': [s.visited, 15, 'buildings'], 'explorer-all': [s.visited, s.allBuildings, 'buildings'],
    foodie: [s.visitedCount(s.dining), s.dining.length, 'dining halls'], 'hall-hopper': [s.visitedCount(s.residence), 5, 'residence halls'],
    scholar: [s.visitedCount(s.academic), 10, 'academic buildings'], champion: [s.challengeWeeks, 1, 'challenge week'],
    buddy: [s.safeWalks, 1, 'safe walk'], 'hall-champion': [s.hallWins, 1, 'Hall Cup win'], 'hall-dynasty': [s.hallWins, 3, 'Hall Cup wins'],
  };
  return Object.fromEntries(Object.entries(P).map(([id, [have, need, unit]]) => [id, { have: Math.min(Math.floor(have * 10) / 10, need), need, unit }]));
}

/** Badge ids earned now but not recorded in data.badges yet. */
export function newBadges(data, buildings) {
  const s = lifetimeStats(data, buildings);
  return BADGES.filter((b) => !data.badges?.[b.id] && b.test(s)).map((b) => b.id);
}
