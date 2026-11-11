// Walk tracker: GPS distance + motion-sensor steps while TigerPath is open.
//
// Browsers pause web apps when the screen is off or the app is in the
// background, so we keep the screen awake (Wake Lock) while tracking and
// only count what we can actually measure. Only daily totals are saved.

import { TrackAccumulator, StepDetector, addActivity, dayKey, stepsFromMeters, strideFromHeight, goalProgress } from '../lib/activity.js';

export function createTracker({ acc, onUpdate = () => {}, onGoal = () => {}, onFix = () => {} }) {
  let state = null; // { source, started, track, detector, motionSteps, watchId, wake, timer, committed }

  const stride = () => strideFromHeight(acc.data.settings.heightCm);
  const totals = () => {
    if (!state) return null;
    const usingMotion = state.detector.steps > 0;
    // once the motion sensor starts counting, keep the distance-based estimate from before it kicked in
    if (usingMotion && state.estimateBeforeMotion == null) state.estimateBeforeMotion = stepsFromMeters(state.track.meters, stride());
    return {
      meters: state.track.meters,
      campusMeters: state.track.campusMeters,
      steps: usingMotion ? state.estimateBeforeMotion + state.detector.steps : stepsFromMeters(state.track.meters, stride()),
      seconds: Math.round((Date.now() - state.started) / 1000),
      usingMotion,
    };
  };

  function flush() {
    if (!state || !acc.user) return;
    const cur = totals(), c = state.committed;
    const delta = {
      meters: Math.max(0, cur.meters - c.meters), campusMeters: Math.max(0, cur.campusMeters - c.campusMeters),
      steps: Math.max(0, cur.steps - c.steps), seconds: Math.max(0, cur.seconds - c.seconds),
    };
    if (!delta.meters && !delta.steps && delta.seconds < 30) return;
    const day = dayKey();
    const before = goalProgress(acc.data.activity[day], acc.data.goals).met;
    acc.update((d) => { d.activity = addActivity(d.activity, day, delta); });
    state.committed = { ...cur };
    if (!before && goalProgress(acc.data.activity[day], acc.data.goals).met) onGoal();
  }

  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (state && a && a.x != null) state.detector.push(a.x, a.y, a.z, e.timeStamp);
  };
  async function keepAwake() {
    try { state.wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
  }
  const onVisible = () => { if (state && document.visibilityState === 'visible') { keepAwake(); flush(); } };

  return {
    get running() { return !!state; },
    get source() { return state?.source ?? null; },
    status: totals,

    /** Call from a click handler (iOS only grants motion access during a user gesture). */
    async start(source = 'manual') {
      if (state || !acc.user) return false;
      if (!navigator.geolocation) throw new Error('Location is not available on this device.');
      try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch { /* steps will be estimated from distance */ }
      state = { source, started: Date.now(), track: new TrackAccumulator(), detector: new StepDetector(),
        committed: { meters: 0, campusMeters: 0, steps: 0, seconds: 0 } };
      state.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp };
          state?.track.add(fix); onFix(fix); onUpdate(totals());
        },
        () => onUpdate(totals(), 'Location unavailable — check permissions.'),
        { enableHighAccuracy: true, maximumAge: 3000 });
      addEventListener('devicemotion', onMotion);
      document.addEventListener('visibilitychange', onVisible);
      await keepAwake();
      state.timer = setInterval(() => { flush(); onUpdate(totals()); }, 5000);
      onUpdate(totals());
      return true;
    },

    stop() {
      if (!state) return null;
      flush();
      const summary = totals();
      navigator.geolocation.clearWatch(state.watchId);
      removeEventListener('devicemotion', onMotion);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(state.timer);
      state.wake?.release?.().catch(() => {});
      state = null;
      acc.flush();
      onUpdate(null);
      return summary;
    },
  };
}
