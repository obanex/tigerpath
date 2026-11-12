// Class reminders: when to notify for each upcoming class.
//
// settings: { leadMinutes: 10, addWalkTime: true, term: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } }
//   leadMinutes  how long before class starts the student wants the reminder
//   addWalkTime  also add the walk from the previous class that day (so you leave on time)

import { dayKey } from './activity.js';

const JS_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const at = (date, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(date); d.setHours(h, m, 0, 0); return d; };

/** Class meetings starting within [now, now + horizonHours], soonest first. */
export function upcomingClasses(classes, now = new Date(), horizonHours = 36, term = null) {
  const out = [];
  for (let i = 0; i <= Math.ceil(horizonHours / 24); i++) {
    const day = new Date(now); day.setDate(day.getDate() + i);
    const k = dayKey(day);
    if (term?.start && k < term.start) continue;
    if (term?.end && k > term.end) continue;
    const dow = JS_DAYS[day.getDay()];
    for (const c of classes) {
      if (!c.days.includes(dow)) continue;
      const start = at(day, c.start);
      if (start > now && start - now <= horizonHours * 3600e3) out.push({ cls: c, start, day: k, dow });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Reminder plan. walkMinutes(fromBuilding, toBuilding) -> minutes | null.
 * Returns [{ id, cls, start, fireAt, leaveBy, walk, from, title, body }].
 */
export function planReminders(classes, now, settings, walkMinutes = () => null, horizonHours = 36) {
  const lead = settings.leadMinutes ?? 10;
  return upcomingClasses(classes, now, horizonHours, settings.term).map(({ cls, start, day, dow }) => {
    // previous class the same day that ends before this one starts
    const prev = classes
      .filter((c) => c.id !== cls.id && c.days.includes(dow) && at(start, c.end) <= start)
      .sort((a, b) => at(start, b.end) - at(start, a.end))[0];
    const walk = settings.addWalkTime && prev && prev.building !== cls.building ? walkMinutes(prev.building, cls.building) : null;
    const leaveBy = walk != null ? new Date(start - Math.ceil(walk) * 60e3) : null;
    const fireAt = new Date((leaveBy ?? start) - lead * 60e3);
    return { id: `${cls.id}@${day}`, cls, start, fireAt, leaveBy, walk, from: prev?.building ?? null };
  });
}

/** Reminders that should fire now: due, class not started yet, and not already sent. */
export function dueReminders(plan, now, sent = new Set()) {
  return plan.filter((r) => r.fireAt <= now && r.start > now && !sent.has(r.id));
}
