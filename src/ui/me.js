// "Me" tab: account, daily goals, activity tracking and history.

import { goalProgress, streak, lastDays, dayKey, METERS_PER_MILE } from '../lib/activity.js';
import { BADGES, weeklyChallenges, weekStats, challengeProgress, weekKey } from '../lib/challenges.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtInt = (n) => Math.round(n).toLocaleString();
const fmtMiles = (m) => (m / METERS_PER_MILE).toFixed(2);

function ring(pct, big, small, label) {
  const r = 42, c = 2 * Math.PI * r;
  return `<figure class="ring" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 100 100" width="120" height="120" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="ring-track" />
      ${pct > 0.005 ? `<circle cx="50" cy="50" r="${r}" class="ring-fill" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)" />` : ''}
    </svg>
    <figcaption><b>${big}</b><span>${small}</span></figcaption></figure>`;
}

/** Single-series column chart: steps per day for the last 7 days, with a goal reference line. */
function weekChart(days, goal) {
  const W = 320, H = 150, padL = 36, padB = 22, padT = 10;
  const max = Math.max(goal || 0, ...days.map((d) => d.steps), 1000);
  const nice = Math.ceil(max / 2500) * 2500;
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const band = (W - padL) / days.length, bw = Math.min(24, band - 8);
  const today = dayKey();
  const ticks = [0, nice / 2, nice];
  const tick = (v) => (v >= 10000 ? `${v / 1000}K` : v.toLocaleString());
  const bars = days.map((d, i) => {
    const x = padL + i * band + (band - bw) / 2, top = y(d.steps), h = Math.max(0, y(0) - top);
    const r = Math.min(4, h); const lbl = d.date.toLocaleDateString([], { weekday: 'short' });
    const path = h > 0 ? `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z` : '';
    return `<g class="bar${d.day === today ? ' today' : ''}" tabindex="0" data-tip="${esc(`${d.date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}: ${fmtInt(d.steps)} steps · ${fmtMiles(d.meters)} mi`)}">
      <rect class="hit" x="${padL + i * band}" y="${padT}" width="${band}" height="${H - padT - padB}" />
      ${path ? `<path d="${path}" />` : ''}
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="axis${d.day === today ? ' strong' : ''}">${lbl}</text></g>`;
  }).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="week-chart" role="img" aria-label="Steps per day, last 7 days">
    ${ticks.map((t) => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid" /><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end" class="axis">${tick(t)}</text>`).join('')}
    ${goal ? `<line x1="${padL}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal" /><text x="${W}" y="${y(goal) - 4}" text-anchor="end" class="axis">Goal ${fmtInt(goal)}</text>` : ''}
    ${bars}</svg><div class="chart-tip" hidden></div></div>
    <table class="sr-only"><caption>Steps per day</caption><tr><th>Day</th><th>Steps</th><th>Miles</th></tr>
    ${days.map((d) => `<tr><td>${d.day}</td><td>${fmtInt(d.steps)}</td><td>${fmtMiles(d.meters)}</td></tr>`).join('')}</table>`;
}

const PREF_ROUTES = [['fastest', '🚶 Fastest'], ['stepfree', '♿ Step-free'], ['lit', '🌙 Best lit']];
const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const seg = (name, options, value) => `<div class="seg" role="radiogroup" data-pref="${name}">${options.map(([v, l]) =>
  `<button type="button" role="radio" aria-checked="${v === value}" data-v="${v}">${l}</button>`).join('')}</div>`;

/**
 * el: account view container · welcomeEl: welcome overlay · buildings: for the "home" picker
 * onPrefs(key): called after a preference changes so the app can apply it
 */
export function createMeView({ el, actEl, welcomeEl, acc, tracker, toast, buildings, onPrefs = () => {}, onNavigate = () => {}, hallCup = null, phoneSteps = null }) {
  let mode = 'signup';

  /** Sign-up / sign-in form, used on the welcome screen. */
  function authForm(host, onDone) {
    host.innerHTML = `
      <div class="seg" role="tablist" aria-label="Account">
        <button role="tab" aria-selected="${mode === 'signup'}" data-mode="signup">Create account</button>
        <button role="tab" aria-selected="${mode === 'signin'}" data-mode="signin">Sign in</button></div>
      <form class="authForm" novalidate>
        ${mode === 'signup' ? '<div class="field"><label for="aName">Name</label><input id="aName" autocomplete="name" required /></div>' : ''}
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="email" placeholder="you@students.towson.edu" required /></div>
        <div class="field"><label for="aPass">Password</label><input id="aPass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required />
          ${mode === 'signup' ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
        <p class="form-error" id="authErr" role="alert" hidden></p>
        <button class="btn primary wide" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="hint center">${acc.backend.kind === 'cloud' ? 'Your account syncs across your devices.'
        : 'Your account is saved on this device. Your password is hashed and never leaves your phone.'}</p>`;
    host.querySelector('.seg').onclick = (e) => { const m = e.target.closest('button')?.dataset.mode; if (m) { mode = m; authForm(host, onDone); } };
    host.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const err = host.querySelector('#authErr'); err.hidden = true;
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const fields = { name: host.querySelector('#aName')?.value, email: host.querySelector('#aEmail').value, password: host.querySelector('#aPass').value };
      try {
        const res = mode === 'signup' ? await acc.signUp(fields) : await acc.signIn(fields);
        if (res?.needsConfirmation) { err.textContent = `Check ${res.email} for a confirmation link, then sign in.`; err.hidden = false; mode = 'signin'; }
        else { toast(mode === 'signup' ? `Welcome, ${acc.user.name}!` : `Welcome back, ${acc.user.name}!`); onDone?.(); }
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { btn.disabled = false; }
    };
  }

  function showWelcome() {
    authForm(welcomeEl.querySelector('#welcomeAuth'), hideWelcome);
    welcomeEl.hidden = false;
    welcomeEl.querySelector('#guestBtn').onclick = () => { try { sessionStorage.setItem('tigerpath.guestSession', '1'); } catch { /* ignore */ } hideWelcome(); };
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => welcomeEl.querySelector('input')?.focus(), 50); // no surprise keyboard on phones
  }
  function hideWelcome() {
    const hadFocus = welcomeEl.contains(document.activeElement);
    welcomeEl.hidden = true;
    if (hadFocus) document.getElementById('appTitle')?.focus({ preventScroll: true }); // don't drop keyboard users on <body>
  }

  function preferences() {
    const st = acc.data.settings;
    const homeOpts = [...buildings].sort((a, b) => (a.category === 'residence' ? 0 : 1) - (b.category === 'residence' ? 0 : 1) || a.name.localeCompare(b.name));
    return `<details class="card" id="prefCard" ${acc.user ? '' : 'open'}><summary>🎛️ Preferences</summary>
      <div class="field"><span class="label">Preferred route</span>${seg('preferredRoute', PREF_ROUTES, st.preferredRoute ?? 'fastest')}
        <span class="hint">Directions always show every option; this one is picked first.</span></div>
      <label class="check"><input type="checkbox" data-pref="avoidStairs" ${st.avoidStairs ? 'checked' : ''}/> Always avoid stairs</label>
      <label class="check"><input type="checkbox" data-pref="autoNight" ${st.autoNight ?? true ? 'checked' : ''}/> Pick the best-lit route after dark</label>
      <label class="check"><input type="checkbox" data-pref="strictAccess" ${st.strictAccess ? 'checked' : ''}/> Step-free routes also avoid steep slopes and gravel/grass</label>
      <div class="row">
        <div class="field"><label for="pPace">Walking pace</label><select id="pPace" data-pref="pace">
          ${[['1', 'Wheelchair / mobility aid'], ['1.1', 'Relaxed'], ['1.34', 'Typical'], ['1.6', 'Brisk']].map(([v, l]) => `<option value="${v}" ${String(st.pace ?? 1.34) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="pUnits">Units</label><select id="pUnits" data-pref="units">
          ${[['imperial', 'Feet / miles'], ['metric', 'Meters / km']].map(([v, l]) => `<option value="${v}" ${(st.units ?? 'imperial') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="pHome">Home on campus</label><select id="pHome" data-pref="home">
        <option value="">None</option>${homeOpts.map((b) => `<option value="${esc(b.id)}" ${st.home === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <span class="hint">Adds a one-tap “Directions home” button.</span></div>
      <div class="field"><span class="label">Theme</span>${seg('theme', THEMES, st.theme ?? 'system')}</div>
    </details>`;
  }

  /** iPhone app only: steps from the phone's own step counter. */
  function phoneStepsCard() {
    const st = phoneSteps?.status();
    if (!st || st === 'unavailable' || acc.data.settings.phoneSteps === false) return '';
    if (st === 'granted') return '<p class="hint">📱 Steps and distance come from your iPhone’s step counter, so every walk counts — even when TigerPath is closed.</p>';
    if (st === 'denied') return '<p class="hint">📱 To count steps automatically, allow <b>Motion &amp; Fitness</b> for TigerPath in the iPhone Settings app.</p>';
    return `<div class="card phone-steps"><b>📱 Count steps from your iPhone</b>
      <p class="hint">Fills in your steps every day, even when TigerPath is closed, and counts them for your Hall Cup team. Only daily totals are saved.</p>
      <button class="btn primary small" id="phoneStepsBtn">Turn on</button></div>`;
  }

  function hallCupSection({ readOnly = false } = {}) {
    if (!hallCup) return '';
    const st = acc.data.settings, board = hallCup.board();
    const mine = st.hallCup === false ? null : st.hall;
    const select = `<div class="field"><label for="pHall">Your team</label><select id="pHall" data-pref="hall">
      <option value="">Not competing</option>${hallCup.teams.map((t) => `<option value="${esc(t.id)}" ${st.hall === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
    if (!hallCup.cloud) return `<h3 class="h">🏆 Hall Cup</h3><p class="hint">The Hall Cup needs cloud accounts.</p>`;
    const rows = board?.rows ?? [];
    const last = hallCup.lastWinner?.();
    return `<h3 class="h">🏆 Hall Cup · this week</h3>
      ${last ? `<p class="last-winner">Last week's champion: <b>${esc(last.name)}</b> · ${last.avg.toLocaleString()} avg steps 🏆</p>` : ''}
      ${readOnly ? '' : select}
      ${rows.length ? `<table class="board"><thead><tr><th>#</th><th>Team</th><th>Avg steps</th><th>Walkers</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.mine ? 'mine' : ''}"><td>${r.rank ?? '–'}</td><td>${esc(r.name)}${r.mine ? ' <span class="rbadge q">You</span>' : ''}</td>
          <td>${r.avg != null ? r.avg.toLocaleString() : `<span class="muted small">needs ${r.needs} more</span>`}</td><td>${r.walkers}</td></tr>`).join('')}</tbody></table>`
        : `<p class="hint">${board?.error ? 'Couldn’t load the Hall Cup right now.' : 'No steps logged this week yet — be the first for your hall!'}</p>`}
      <p class="hint">Halls are ranked by average steps per walker and need 3+ walkers to be ranked. Only your hall and weekly step count are shared, as part of a hall total — never your name or where you walked.${readOnly ? ' Sign in to compete.' : mine ? '' : ' Pick a team to join.'}</p>`;
  }

  function achievements() {
    const d = acc.data;
    const ch = challengeProgress(weeklyChallenges(weekKey(), d.goals), weekStats(d));
    const earned = BADGES.filter((b) => d.badges?.[b.id]);
    const visited = Object.keys(d.visits ?? {}).length;
    return `<h3 class="h">This week's challenges</h3>
      <ul class="pulse-list ch">${ch.map((c) => `<li><span>${c.icon} ${esc(c.title)}</span>${c.done ? '<span class="done">✓</span>' : `<span class="small muted">${Math.floor(c.value * 10) / 10}/${c.target}</span>`}
        <span class="pbar"><span style="width:${Math.round(c.pct * 100)}%"></span></span></li>`).join('')}</ul>
      <p class="hint">New challenges every Monday. Buildings count as visited when you're there with location on — ${visited} of ${buildings.length} so far.</p>
      <h3 class="h">Badges · ${earned.length} of ${BADGES.length}</h3>
      <ul class="badges">${BADGES.map((b) => { const on = d.badges?.[b.id];
        return `<li class="${on ? 'on' : ''}" title="${esc(b.desc)}"><span class="bicon" aria-hidden="true">${on ? b.icon : '🔒'}</span><b>${esc(b.title)}</b><span>${esc(b.desc)}</span></li>`; }).join('')}</ul>`;
  }

  function bindPrefs(root) {
    const set = (key, value) => { acc.update((d) => { d.settings[key] = value; }); onPrefs(key); };
    root.querySelectorAll('.seg[data-pref]').forEach((g) => { g.onclick = (e) => {
      const v = e.target.closest('button')?.dataset.v; if (!v) return;
      g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
      set(g.dataset.pref, v);
    }; });
    root.querySelectorAll('input[type=checkbox][data-pref]').forEach((c) => { c.onchange = () => set(c.dataset.pref, c.checked); });
    root.querySelectorAll('select[data-pref]').forEach((s) => { s.onchange = () => set(s.dataset.pref, s.dataset.pref === 'pace' ? +s.value : s.value || null); });
  }

  // ---------------------------------------------------------------- My account
  const about = `<p class="hint about">TU TigerPath is an independent student project, not an official university app.
    <a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a> · <a href="support.html" target="_blank" rel="noopener">Support</a></p>`;
  function accountView() {
    if (!acc.user) {
      el.innerHTML = `
        <div class="me-head"><div class="avatar big" aria-hidden="true">👤</div><div class="grow"><h2 class="me-title">Guest</h2>
          <span class="muted small">Your settings are saved on this device.</span></div></div>
        <button class="btn primary wide" id="openWelcome">Sign in or create an account</button>
        <ul class="perks"><li>🎯 Daily step and mile goals</li><li>🏆 Compete for your hall in the Hall Cup</li><li>☁️ Your classes and settings on all your devices</li></ul>
        ${preferences()}${about}`;
      el.querySelector('#openWelcome').onclick = showWelcome;
      bindPrefs(el);
      return;
    }
    const initials = acc.user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    el.innerHTML = `
      <div class="me-head"><div class="avatar big" aria-hidden="true">${esc(initials)}</div>
        <div class="grow"><h2 class="me-title">${esc(acc.user.name)}</h2><span class="muted small">${esc(acc.user.email)}</span></div>
        <button class="btn small" id="signOut">Sign out</button></div>
      <button class="link-btn" id="toActivity">👟 Your steps, challenges, Hall Cup and badges are in the Activity tab →</button>
      ${preferences()}
      <details class="card"><summary>⚙️ Account & data</summary>
        <p class="hint">${acc.backend.kind === 'cloud' ? 'Synced to your TigerPath cloud account.' : 'Saved on this device.'}</p>
        <div class="btn-row"><button class="btn" id="exportData">Download my data</button><button class="btn danger" id="deleteAcct">Delete account</button></div>
        <p class="hint">Deleting removes your login and everything saved with it, immediately.</p>
      </details>${about}`;
    bindPrefs(el);
    el.querySelector('#toActivity').onclick = () => onNavigate('activity');
    el.querySelector('#signOut').onclick = async () => { if (tracker.running) tracker.stop(); await acc.signOut(); toast('Signed out'); };
    el.querySelector('#exportData').onclick = () => {
      const blob = new Blob([JSON.stringify({ account: acc.user, ...acc.data }, null, 2)], { type: 'application/json' });
      const file = new File([blob], 'tigerpath-data.json', { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file], title: 'My TigerPath data' }).catch(() => {}); return; } // iPhone app: Save to Files, AirDrop…
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tigerpath-data.json' });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    el.querySelector('#deleteAcct').onclick = async () => {
      if (!confirm('Delete your TigerPath account and all its data? This cannot be undone.')) return;
      if (tracker.running) tracker.stop();
      await acc.deleteAccount(); toast('Account deleted');
    };
  }

  // ---------------------------------------------------------------- Activity tab
  function activityGuest() {
    actEl.innerHTML = `
      <h2 class="me-title">Activity</h2>
      <p class="small">Track your walks around campus, hit daily goals, take on weekly challenges, collect badges and help your hall win the Hall Cup.</p>
      <button class="btn primary wide" id="actSignIn">Sign in to start</button>
      ${hallCupSection({ readOnly: true })}
      ${achievements()}`;
    actEl.querySelector('#actSignIn').onclick = showWelcome;
  }

  function activitySignedIn() {
    const { goals, settings, activity } = acc.data;
    const live = tracker.status();
    const todayTotals = activity[dayKey()];
    const p = goalProgress(todayTotals, goals);
    const st = streak(activity, goals);
    const campusMi = (todayTotals?.campusMeters ?? 0) / METERS_PER_MILE;
    const minutes = Math.round((todayTotals?.seconds ?? 0) / 60);
    const ft = settings.heightCm ? Math.floor(settings.heightCm / 30.48) : '';
    const inch = settings.heightCm ? Math.round((settings.heightCm / 2.54) % 12) : '';
    actEl.innerHTML = `
      <h2 class="sr-only">Activity</h2>
      <h3 class="h first">Today</h3>
      <div class="rings">
        ${ring(p.stepsPct, fmtInt(p.steps), `of ${fmtInt(goals.steps)} steps`, `${fmtInt(p.steps)} of ${fmtInt(goals.steps)} steps`)}
        ${ring(p.milesPct, p.miles.toFixed(2), `of ${goals.miles} miles`, `${p.miles.toFixed(2)} of ${goals.miles} miles`)}
      </div>
      <div class="stats">
        <div><b>${campusMi.toFixed(2)}</b><span>mi on campus</span></div>
        <div><b>${minutes}</b><span>active min</span></div>
        <div><b>${st}${st ? ' 🔥' : ''}</b><span>day streak</span></div>
      </div>
      ${p.met ? '<p class="goal-met">🎉 Goal reached today. Nice work!</p>' : ''}
      ${phoneStepsCard()}
      <button class="btn ${live ? '' : 'primary'} wide" id="trackBtn">${live ? '■ Stop tracking' : '▶ Start tracking a walk'}</button>
      <p class="hint" id="trackStatus" aria-live="polite">${live
        ? `Tracking · ${fmtMiles(live.meters)} mi · ${fmtInt(live.steps)} steps${live.usingMotion ? '' : ' (estimated from distance)'}. Keep TigerPath open — phones pause web apps in the background.`
        : 'Walks you navigate with ▶ Start count automatically. Only daily totals are saved, never your route.'}</p>

      <h3 class="h">Last 7 days</h3>
      ${weekChart(lastDays(activity, 7), goals.steps)}

      ${hallCupSection()}

      ${achievements()}

      <details class="card" id="goalCard"><summary>🎯 Goals</summary>
        <form id="goalForm">
          <div class="row">
            <div class="field"><label for="gSteps">Steps per day</label><input id="gSteps" type="number" min="500" max="50000" step="500" value="${goals.steps}" /></div>
            <div class="field"><label for="gMiles">Miles per day</label><input id="gMiles" type="number" min="0.5" max="30" step="0.5" value="${goals.miles}" /></div>
          </div>
          <fieldset class="field"><legend>Your height (for step length)</legend>
            <div class="row"><div class="field"><label for="hFt" class="sr-only">Feet</label><input id="hFt" type="number" min="3" max="8" placeholder="ft" value="${ft}" /></div>
            <div class="field"><label for="hIn" class="sr-only">Inches</label><input id="hIn" type="number" min="0" max="11" placeholder="in" value="${inch}" /></div></div></fieldset>
          <button class="btn primary" type="submit">Save goals</button>
        </form></details>`;

    bindPrefs(actEl); // Hall Cup team picker
    const psb = actEl.querySelector('#phoneStepsBtn');
    if (psb) psb.onclick = async () => { psb.disabled = true; await phoneSteps.enable(); render(); };
    actEl.querySelector('#trackBtn').onclick = async () => {
      if (tracker.running) {
        const s = tracker.stop();
        toast(s && s.meters > 10 ? `Walk saved: ${fmtMiles(s.meters)} mi, ${fmtInt(s.steps)} steps` : 'Tracking stopped');
      } else {
        try { await tracker.start('manual'); } catch (ex) { toast(ex.message); }
      }
      render();
    };
    actEl.querySelector('#goalForm').onsubmit = (e) => {
      e.preventDefault();
      const steps = Math.max(500, Math.round(+actEl.querySelector('#gSteps').value || goals.steps));
      const miles = Math.max(0.5, +actEl.querySelector('#gMiles').value || goals.miles);
      const f = +actEl.querySelector('#hFt').value, i = +actEl.querySelector('#hIn').value || 0;
      acc.update((d) => { d.goals = { steps, miles }; d.settings.heightCm = f ? Math.round((f * 12 + i) * 2.54) : null; });
      toast('Goals saved');
    };
    // chart tooltip (hover + keyboard focus)
    const tip = actEl.querySelector('.chart-tip'), wrap = actEl.querySelector('.chart-wrap');
    const showTip = (g) => {
      tip.textContent = g.dataset.tip; tip.hidden = false;
      const r = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(0, r.left - w.left + r.width / 2 - tip.offsetWidth / 2), w.width - tip.offsetWidth)}px`;
    };
    actEl.querySelectorAll('.bar').forEach((g) => {
      g.addEventListener('mouseenter', () => showTip(g)); g.addEventListener('focus', () => showTip(g));
      g.addEventListener('mouseleave', () => (tip.hidden = true)); g.addEventListener('blur', () => (tip.hidden = true));
    });
  }

  const typing = (root) => root.contains(document.activeElement) && document.activeElement.matches('input[type=number], input[type=text], input:not([type])');
  function render() {
    // don't wipe a form the student is typing in
    if (typing(actEl)) {
      const s = actEl.querySelector('#trackStatus'), live = tracker.status();
      if (s && live) s.textContent = `Tracking · ${fmtMiles(live.meters)} mi · ${fmtInt(live.steps)} steps`;
    } else {
      const goalsOpen = actEl.querySelector('#goalCard')?.open;
      if (acc.user) activitySignedIn(); else activityGuest();
      if (goalsOpen && actEl.querySelector('#goalCard')) actEl.querySelector('#goalCard').open = true;
    }
    if (!typing(el)) {
      const prefsOpen = el.querySelector('#prefCard')?.open;
      accountView();
      if (prefsOpen != null && el.querySelector('#prefCard')) el.querySelector('#prefCard').open = prefsOpen;
    }
  }
  return { render, showWelcome, hideWelcome };
}
