// Activity tracking: distance from GPS, steps from the motion sensor (or
// estimated from distance), daily totals, goals and streaks.
//
// Privacy: only daily totals are stored — never the GPS track itself.

import { distance } from './geo.js';
import { CAMPUS_BBOX } from './osm.js';

export const METERS_PER_MILE = 1609.344;
export const DEFAULT_GOALS = { steps: 7500, miles: 3 };

export const insideCampus = (p) =>
  p.lat >= CAMPUS_BBOX[0] && p.lat <= CAMPUS_BBOX[2] && p.lng >= CAMPUS_BBOX[1] && p.lng <= CAMPUS_BBOX[3];

/** Average stride ≈ 41.4% of height. Falls back to 0.76 m (≈ 2.5 ft). */
export const strideFromHeight = (cm) => (cm > 100 && cm < 250 ? (cm / 100) * 0.414 : 0.76);
export const stepsFromMeters = (m, strideM = 0.76) => Math.round(m / strideM);

/** Local calendar day, 'YYYY-MM-DD'. */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Turns a stream of GPS fixes into walked distance, ignoring:
 *  - inaccurate fixes (accuracy worse than maxAccuracy meters)
 *  - jitter while standing still (moves smaller than the fix accuracy)
 *  - riding a car or shuttle (speed above maxSpeed m/s ≈ 14 mph)
 */
export class TrackAccumulator {
  constructor({ maxAccuracy = 35, maxSpeed = 6.5, minMove = 5 } = {}) {
    Object.assign(this, { maxAccuracy, maxSpeed, minMove });
    this.last = null;
    this.meters = 0;
    this.campusMeters = 0;
  }
  /** fix: { lat, lng, acc (m), t (ms) }. Returns meters added. */
  add(fix) {
    if (fix.acc > this.maxAccuracy) return 0;
    if (!this.last) { this.last = fix; return 0; }
    const d = distance(this.last, fix);
    const dt = (fix.t - this.last.t) / 1000;
    if (d < Math.max(this.minMove, Math.min(fix.acc, this.last.acc) * 0.5)) return 0; // jitter: keep anchor
    if (dt <= 0 || d / dt > this.maxSpeed) { this.last = fix; return 0; } // vehicle or bad clock: skip segment
    const onCampus = insideCampus(this.last) && insideCampus(fix);
    this.last = fix;
    this.meters += d;
    if (onCampus) this.campusMeters += d;
    return d;
  }
}

/**
 * Step detection from DeviceMotion accelerationIncludingGravity samples.
 * Smooths the magnitude, tracks a slow baseline, and counts a step on each peak
 * that rises far enough above the baseline, at a plausible walking cadence.
 */
export class StepDetector {
  constructor({ threshold = 1.1, minInterval = 260, maxInterval = 2000 } = {}) {
    Object.assign(this, { threshold, minInterval, maxInterval });
    this.smooth = null; this.base = null; this.above = false; this.lastStep = -Infinity; this.steps = 0;
  }
  push(x, y, z, t) {
    const m = Math.hypot(x, y, z);
    this.smooth = this.smooth == null ? m : this.smooth + 0.25 * (m - this.smooth);
    this.base = this.base == null ? m : this.base + 0.02 * (m - this.base);
    const high = this.smooth - this.base > this.threshold;
    let stepped = false;
    if (high && !this.above && t - this.lastStep >= this.minInterval) {
      this.steps++; this.lastStep = t; stepped = true;
    }
    if (this.smooth - this.base < this.threshold * 0.4) this.above = false;
    else if (high) this.above = true;
    return stepped;
  }
}

/** Adds a session's increments to the day's totals (returns a new activity object). */
export function addActivity(activity, day, { meters = 0, campusMeters = 0, steps = 0, seconds = 0 }) {
  const cur = activity[day] ?? { meters: 0, campusMeters: 0, steps: 0, seconds: 0 };
  return { ...activity, [day]: {
    meters: cur.meters + meters, campusMeters: cur.campusMeters + campusMeters,
    steps: cur.steps + steps, seconds: cur.seconds + seconds,
  } };
}

export function goalProgress(dayTotals, goals = DEFAULT_GOALS) {
  const t = dayTotals ?? { meters: 0, steps: 0 };
  const miles = t.meters / METERS_PER_MILE;
  return {
    steps: t.steps, miles,
    stepsPct: goals.steps ? Math.min(1, t.steps / goals.steps) : 0,
    milesPct: goals.miles ? Math.min(1, miles / goals.miles) : 0,
    met: (goals.steps && t.steps >= goals.steps) || (goals.miles && miles >= goals.miles),
  };
}

/** Consecutive days meeting a goal, ending today (today counts only once met). */
export function streak(activity, goals = DEFAULT_GOALS, today = new Date()) {
  const d = new Date(today);
  let n = 0;
  if (!goalProgress(activity[dayKey(d)], goals).met) d.setDate(d.getDate() - 1);
  while (goalProgress(activity[dayKey(d)], goals).met) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** Last n days (oldest first) with totals, for charts. */
export function lastDays(activity, n = 7, today = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    out.push({ day: k, date: d, ...(activity[k] ?? { meters: 0, campusMeters: 0, steps: 0, seconds: 0 }) });
  }
  return out;
}
