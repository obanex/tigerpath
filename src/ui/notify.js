// Class reminders: checks every 20 s and shows a notification (plus an in-app
// banner) when it's time to head to class.
//
// Web apps can only run while open (in a tab or installed). For reminders when
// TigerPath is closed, the calendar export (.ics) carries the same alarm, which
// the phone's calendar app fires reliably.

import { planReminders, dueReminders } from '../lib/reminders.js';
import { formatTime } from '../lib/hours.js';

const SENT_KEY = 'tigerpath.remindersSent';
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function createReminders({ acc, walkMinutes, buildingName, onFire }) {
  let sent;
  try { sent = new Set(JSON.parse(localStorage.getItem(SENT_KEY)) ?? []); } catch { sent = new Set(); }
  const saveSent = () => {
    const recent = [...sent].slice(-200);
    try { localStorage.setItem(SENT_KEY, JSON.stringify(recent)); } catch { /* ignore */ }
  };

  const plan = (now = new Date()) => planReminders(acc.data.schedule, now, acc.data.settings, walkMinutes);

  function describe(r) {
    const where = `${buildingName(r.cls.building)}${r.cls.room ? ' ' + r.cls.room : ''}`;
    const mins = Math.max(0, Math.round((r.start - Date.now()) / 60000));
    const title = `${r.cls.title} at ${formatTime(hhmm(r.start))}`;
    const body = r.leaveBy
      ? `${where}. ${Math.ceil(r.walk)} min walk from ${buildingName(r.from)} — leave by ${formatTime(hhmm(r.leaveBy))}.`
      : `${where} · starts in ${mins} min.`;
    const url = `${location.pathname}#from=${r.from ?? 'me'}&to=${encodeURIComponent(r.cls.building)}`;
    return { title, body, url };
  }

  async function show(r) {
    const { title, body, url } = describe(r);
    onFire?.(r, { title, body, url });
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag: r.id, data: { url }, icon: 'icon.svg', badge: 'icon.svg', renotify: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return; }
    } catch { /* fall back */ }
    try { new Notification(title, opts); } catch { /* some browsers only allow SW notifications */ }
  }

  function tick() {
    if (!acc.data.settings.notifications) return;
    for (const r of dueReminders(plan(), new Date(), sent)) { sent.add(r.id); show(r); }
    saveSent();
  }

  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());

  return {
    tick, plan, describe,
    get permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; },
    /** Turn reminders on; asks for notification permission (must be called from a click). */
    async enable() {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      acc.update((d) => { d.settings.notifications = true; });
      tick();
      return this.permission;
    },
    disable() { acc.update((d) => { d.settings.notifications = false; }); },
    /** Show a sample reminder right away. */
    test() {
      const cls = acc.data.schedule[0] ?? { id: 'test', title: 'Sample class', building: 'LA', room: '4310' };
      show({ id: 'test-' + Date.now(), cls, start: new Date(Date.now() + (acc.data.settings.leadMinutes ?? 10) * 60000), leaveBy: null });
    },
  };
}
