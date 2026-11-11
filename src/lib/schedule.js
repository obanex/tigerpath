// Class schedule: plan a day of classes, check walking feasibility, export .ics.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const KEY = 'tigernav.schedule.v1';

export function loadSchedule(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function saveSchedule(classes, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(classes)); } catch { /* private mode */ }
}

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Classes on a given day, sorted by start time. */
export function classesOn(classes, day) {
  return classes.filter((c) => c.days.includes(day)).sort((a, b) => toMin(a.start) - toMin(b.start));
}

/**
 * Legs between consecutive classes. walkMinutes(fromBuildingId, toBuildingId) -> number|null.
 * status: 'ok' | 'tight' (≤ 3 min spare) | 'late' (cannot make it) | 'overlap'
 */
export function planDay(classes, day, walkMinutes) {
  const list = classesOn(classes, day);
  const legs = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i], b = list[i + 1];
    const gap = toMin(b.start) - toMin(a.end);
    const walk = a.building === b.building ? 1 : walkMinutes(a.building, b.building);
    let status = 'ok';
    if (gap < 0) status = 'overlap';
    else if (walk != null && walk > gap) status = 'late';
    else if (walk != null && gap - walk <= 3) status = 'tight';
    legs.push({ from: a, to: b, gap, walk, status });
  }
  return { classes: list, legs };
}

// ---------- iCalendar export ----------
const ICS_DAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };
const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * termStart/termEnd: 'YYYY-MM-DD'. Times are floating local times (no TZID), which
 * calendar apps interpret in the user's own zone — correct for an on-campus schedule.
 */
export function toICS(classes, { termStart, termEnd, buildingName = (id) => id, now = new Date() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TigerNav//Class Schedule//EN', 'CALSCALE:GREGORIAN'];
  const start = new Date(termStart + 'T00:00:00');
  const until = termEnd.replace(/-/g, '') + 'T235959';
  for (const c of classes) {
    // first occurrence on/after termStart
    const jsDays = c.days.map((d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(d));
    const first = new Date(start);
    while (!jsDays.includes(first.getDay())) first.setDate(first.getDate() + 1);
    const ymd = `${first.getFullYear()}${String(first.getMonth() + 1).padStart(2, '0')}${String(first.getDate()).padStart(2, '0')}`;
    const t = (s) => s.replace(':', '') + '00';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${c.id}@tigernav`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${ymd}T${t(c.start)}`,
      `DTEND:${ymd}T${t(c.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${c.days.map((d) => ICS_DAY[d]).join(',')};UNTIL=${until}`,
      `SUMMARY:${esc(c.title)}`,
      `LOCATION:${esc(`${buildingName(c.building)}${c.room ? ' ' + c.room : ''}, Towson University`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545: fold lines longer than 75 octets
  const fold = (l) => { const parts = []; while (l.length > 75) { parts.push(l.slice(0, 75)); l = ' ' + l.slice(75); } parts.push(l); return parts.join('\r\n'); };
  return lines.map(fold).join('\r\n') + '\r\n';
}
