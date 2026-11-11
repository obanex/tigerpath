// Weekly hours: { mon: '07:30-24:00', tue: '08:00-12:00,13:00-17:00', fri: '18:00-02:00', ... }
// A missing day means closed. Ranges past midnight ("18:00-02:00") spill into the next day.

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = (min) => {
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
};
export const formatTime = (hhmm) => fmt(toMin(hhmm));

/** All open intervals for the week, in minutes from Sunday 00:00. */
function intervals(hours) {
  const out = [];
  DAYS.forEach((d, i) => {
    if (!hours?.[d]) return;
    for (const r of hours[d].split(',')) {
      const [a, b] = r.trim().split('-');
      let s = toMin(a), e = toMin(b);
      if (e <= s) e += 1440;
      out.push([i * 1440 + s, i * 1440 + e]);
    }
  });
  return out;
}

/** { open: boolean, label: 'Open · closes 9pm' | 'Closed · opens Mon 7am' | null } */
export function openStatus(hours, date = new Date()) {
  if (!hours) return { open: null, label: null };
  const now = date.getDay() * 1440 + date.getHours() * 60 + date.getMinutes();
  const iv = intervals(hours);
  const week = 7 * 1440;
  for (const [s, e] of iv) {
    for (const off of [0, -week]) {
      if (now >= s + off && now < e + off) {
        const left = e + off - now;
        return { open: true, closingSoon: left <= 60, label: `Open · closes ${fmt(e)}` };
      }
    }
  }
  let best = null;
  for (const [s] of iv) {
    const delta = (s - now + week) % week;
    if (best === null || delta < best.delta) best = { delta, s };
  }
  if (!best) return { open: false, label: 'Closed' };
  const day = Math.floor((best.s % week) / 1440);
  const when = best.delta < 1440 && day === date.getDay() ? '' : `${DAY_LABELS[DAYS[day]]} `;
  return { open: false, label: `Closed · opens ${when}${fmt(best.s)}` };
}

export function weekTable(hours) {
  return DAYS.slice(1).concat('sun').map((d) => ({
    day: DAY_LABELS[d],
    text: hours?.[d] ? hours[d].split(',').map((r) => r.split('-').map(formatTime).join('–')).join(', ') : 'Closed',
  }));
}
