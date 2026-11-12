// iPhone app features (the App Store build, made with Capacitor). On the website
// every function here is a harmless no-op, so the same code serves both.
//
//  - Class reminders become real iOS notifications, scheduled a week ahead,
//    so they arrive even when TigerPath is closed.
//  - Steps come from the iPhone's own step counter (Core Motion), which keeps
//    counting all day, so Activity and the Hall Cup fill in without tracking.
//  - Navigation and Walk With Me keep getting your position with the phone
//    locked (background location), keep the screen on, and tap at turns.

import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
/** Links people share must point at the public website, not the app's internal address. */
export const PUBLIC_URL = 'https://obanex.github.io/tigerpath/';
export const shareBase = () => (isNative ? PUBLIC_URL : new URL(location.pathname, location.origin).href);

const lazy = (load) => { let p; return () => (p ??= load()); };
const notifications = lazy(() => import('@capacitor/local-notifications').then((m) => m.LocalNotifications));
const haptics = lazy(() => import('@capacitor/haptics').then((m) => m.Haptics));
const keepAwake = lazy(() => import('@capacitor-community/keep-awake').then((m) => m.KeepAwake));
const pedometer = lazy(() => import('@capgo/capacitor-pedometer').then((m) => m.CapacitorPedometer));
const app = lazy(() => import('@capacitor/app').then((m) => m.App));
const bgGeo = lazy(() => import('@capacitor/core').then((m) => m.registerPlugin('BackgroundGeolocation')));

// ---------------------------------------------------------------- app lifecycle
/** onResume: the app came back to the front. onOpenUrl(hash): a notification was tapped. */
export async function initNative({ onResume = () => {}, onOpenUrl = () => {} } = {}) {
  if (!isNative) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
  } catch { /* no status bar plugin */ }
  try { (await import('@capacitor/splash-screen')).SplashScreen.hide(); } catch { /* fine */ }
  (await app()).addListener('appStateChange', ({ isActive }) => { if (isActive) onResume(); });
  (await notifications()).addListener('localNotificationActionPerformed', (e) => {
    const url = e.notification?.extra?.url;
    if (url) onOpenUrl(url.includes('#') ? url.slice(url.indexOf('#')) : url);
  });
}

// ---------------------------------------------------------------- class reminders
export async function notificationPermission() {
  if (!isNative) return null;
  return (await (await notifications()).checkPermissions()).display; // 'granted' | 'denied' | 'prompt'
}
export async function requestNotificationPermission() {
  if (!isNative) return null;
  return (await (await notifications()).requestPermissions()).display;
}
const numericId = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 2147483000 + 1; };
/**
 * Replace TigerPath's pending iOS notifications with `reminders`:
 * [{ id, at: Date, title, body, url }]. iOS keeps at most 64 pending, so the soonest 60 are kept.
 */
export async function scheduleReminders(reminders) {
  if (!isNative) return 0;
  const LN = await notifications();
  if ((await LN.checkPermissions()).display !== 'granted') return 0;
  const pending = (await LN.getPending()).notifications;
  if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
  const list = reminders.filter((r) => r.at > new Date()).sort((a, b) => a.at - b.at).slice(0, 60);
  if (list.length) {
    await LN.schedule({ notifications: list.map((r) => ({
      id: numericId(r.id), title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true },
      extra: { url: r.url }, threadIdentifier: 'classes',
    })) });
  }
  return list.length;
}

// ---------------------------------------------------------------- steps from the iPhone
export async function stepPermission() {
  if (!isNative) return null;
  try {
    const P = await pedometer();
    if (!(await P.isAvailable()).stepCounting) return 'unavailable';
    return (await P.checkPermissions()).activityRecognition;
  } catch { return 'unavailable'; }
}
export async function requestStepPermission() {
  if (!isNative) return null;
  try { return (await (await pedometer()).requestPermissions()).activityRecognition; } catch { return 'denied'; }
}
/**
 * Daily steps and distance for the last `days` days from Core Motion (iOS keeps 7 days).
 * Returns { 'YYYY-MM-DD': { steps, meters } }.
 */
export async function stepHistory(days = 7, dayKey) {
  if (!isNative) return {};
  const P = await pedometer();
  const out = {};
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - i);
    const end = i === 0 ? now : new Date(start.getTime() + 864e5 - 1);
    try {
      const m = await P.getMeasurement({ start: start.getTime(), end: end.getTime() });
      if (m.numberOfSteps != null) out[dayKey(start)] = { steps: Math.round(m.numberOfSteps), meters: Math.round(m.distance ?? 0) };
    } catch { /* no data for that day */ }
  }
  return out;
}

// ---------------------------------------------------------------- navigation
let watcherId = null;
/** Keep receiving positions with the phone locked. onFix gets a GeolocationPosition-like object. */
export async function startBackgroundLocation({ title = 'TigerPath', message = 'Following your walk', onFix, onError = () => {} }) {
  if (!isNative || watcherId) return false;
  try {
    (await keepAwake()).keepAwake();
    watcherId = await (await bgGeo()).addWatcher(
      { backgroundTitle: title, backgroundMessage: message, requestPermissions: true, stale: false, distanceFilter: 2 },
      (loc, err) => {
        if (err) { onError(err); return; }
        if (loc) onFix({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, heading: loc.bearing ?? null, speed: loc.speed ?? null }, timestamp: loc.time ?? Date.now() });
      },
    );
    return true;
  } catch (e) { onError(e); return false; }
}
export async function stopBackgroundLocation() {
  if (!isNative) return;
  try { (await keepAwake()).allowSleep(); } catch { /* fine */ }
  if (!watcherId) return;
  const id = watcherId; watcherId = null;
  try { await (await bgGeo()).removeWatcher({ id }); } catch { /* already gone */ }
}
/** A firm tap at a turn (iPhones ignore navigator.vibrate). */
export async function tap(strong = true) {
  if (!isNative) { navigator.vibrate?.(strong ? 180 : 60); return; }
  try { const { ImpactStyle } = await import('@capacitor/haptics'); (await haptics()).impact({ style: strong ? ImpactStyle.Heavy : ImpactStyle.Light }); } catch { /* fine */ }
}
