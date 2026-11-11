// "Me" tab: account, daily goals, activity tracking and history.

import { goalProgress, streak, lastDays, dayKey, METERS_PER_MILE } from '../lib/activity.js';

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

export function createMeView({ el, acc, tracker, toast, backendKind }) {
  let mode = 'signup';

  function signedOut() {
    el.innerHTML = `
      <h2 class="me-title">Your TigerPath account</h2>
      <ul class="perks"><li>🎯 Set daily step and mile goals</li><li>👟 Track your walks around campus</li>
        <li>🔔 Class reminders on your schedule</li><li>📱 Your classes and saved places, in one place</li></ul>
      <div class="seg" role="tablist" aria-label="Account">
        <button role="tab" aria-selected="${mode === 'signup'}" aria-checked="${mode === 'signup'}" data-mode="signup">Create account</button>
        <button role="tab" aria-selected="${mode === 'signin'}" aria-checked="${mode === 'signin'}" data-mode="signin">Sign in</button></div>
      <form id="authForm" novalidate>
        ${mode === 'signup' ? '<div class="field"><label for="aName">Name</label><input id="aName" autocomplete="name" required /></div>' : ''}
        <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" autocomplete="email" placeholder="you@students.towson.edu" required /></div>
        <div class="field"><label for="aPass">Password</label><input id="aPass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required />
          ${mode === 'signup' ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
        <p class="form-error" id="authErr" role="alert" hidden></p>
        <button class="btn primary wide" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="hint">${backendKind === 'cloud'
        ? 'Your account syncs across your devices.'
        : 'Accounts are saved on this device only. Your password is hashed and never leaves your phone.'}</p>`;
    el.querySelector('.seg').onclick = (e) => { const m = e.target.closest('button')?.dataset.mode; if (m) { mode = m; render(); } };
    el.querySelector('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = el.querySelector('#authErr'); err.hidden = true;
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      const fields = { name: el.querySelector('#aName')?.value, email: el.querySelector('#aEmail').value, password: el.querySelector('#aPass').value };
      try {
        const res = mode === 'signup' ? await acc.signUp(fields) : await acc.signIn(fields);
        if (res?.needsConfirmation) { err.textContent = `Check ${res.email} for a confirmation link, then sign in.`; err.hidden = false; mode = 'signin'; }
        else toast(mode === 'signup' ? `Welcome, ${acc.user.name}!` : `Welcome back, ${acc.user.name}!`);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      finally { btn.disabled = false; }
    };
  }

  function signedIn() {
    const { goals, settings, activity } = acc.data;
    const live = tracker.status();
    const todayTotals = activity[dayKey()];
    const p = goalProgress(todayTotals, goals);
    const st = streak(activity, goals);
    const campusMi = (todayTotals?.campusMeters ?? 0) / METERS_PER_MILE;
    const minutes = Math.round((todayTotals?.seconds ?? 0) / 60);
    const ft = settings.heightCm ? Math.floor(settings.heightCm / 30.48) : '';
    const inch = settings.heightCm ? Math.round((settings.heightCm / 2.54) % 12) : '';
    el.innerHTML = `
      <div class="me-head"><div><h2 class="me-title">Hi, ${esc(acc.user.name.split(' ')[0])} 👋</h2><span class="muted small">${esc(acc.user.email)}</span></div>
        <button class="btn small" id="signOut">Sign out</button></div>
      <h3 class="h">Today</h3>
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
      <button class="btn ${live ? '' : 'primary'} wide" id="trackBtn">${live ? '■ Stop tracking' : '▶ Start tracking a walk'}</button>
      <p class="hint" id="trackStatus" aria-live="polite">${live
        ? `Tracking · ${fmtMiles(live.meters)} mi · ${fmtInt(live.steps)} steps${live.usingMotion ? '' : ' (estimated from distance)'}. Keep TigerPath open — phones pause web apps in the background.`
        : 'Walks during “Start walking” directions count automatically. Only daily totals are saved, never your route.'}</p>

      <h3 class="h">Last 7 days</h3>
      ${weekChart(lastDays(activity, 7), goals.steps)}

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
        </form></details>

      <details class="card"><summary>⚙️ Account & data</summary>
        <p class="hint">${acc.backend.kind === 'cloud' ? 'Synced to your TigerPath cloud account.' : 'Saved on this device.'}</p>
        <div class="btn-row"><button class="btn" id="exportData">Download my data</button><button class="btn danger" id="deleteAcct">Delete account</button></div>
      </details>`;

    el.querySelector('#signOut').onclick = async () => { if (tracker.running) tracker.stop(); await acc.signOut(); toast('Signed out'); };
    el.querySelector('#trackBtn').onclick = async () => {
      if (tracker.running) {
        const s = tracker.stop();
        toast(s && s.meters > 10 ? `Walk saved: ${fmtMiles(s.meters)} mi, ${fmtInt(s.steps)} steps` : 'Tracking stopped');
      } else {
        try { await tracker.start('manual'); } catch (ex) { toast(ex.message); }
      }
      render();
    };
    el.querySelector('#goalForm').onsubmit = (e) => {
      e.preventDefault();
      const steps = Math.max(500, Math.round(+el.querySelector('#gSteps').value || goals.steps));
      const miles = Math.max(0.5, +el.querySelector('#gMiles').value || goals.miles);
      const f = +el.querySelector('#hFt').value, i = +el.querySelector('#hIn').value || 0;
      acc.update((d) => { d.goals = { steps, miles }; d.settings.heightCm = f ? Math.round((f * 12 + i) * 2.54) : null; });
      toast('Goals saved');
    };
    el.querySelector('#exportData').onclick = () => {
      const blob = new Blob([JSON.stringify({ account: acc.user, ...acc.data }, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tigerpath-data.json' });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    el.querySelector('#deleteAcct').onclick = async () => {
      if (!confirm('Delete your TigerPath account and all its data? This cannot be undone.')) return;
      if (tracker.running) tracker.stop();
      await acc.deleteAccount(); toast('Account deleted');
    };
    // chart tooltip (hover + keyboard focus)
    const tip = el.querySelector('.chart-tip'), wrap = el.querySelector('.chart-wrap');
    const showTip = (g) => {
      tip.textContent = g.dataset.tip; tip.hidden = false;
      const r = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(0, r.left - w.left + r.width / 2 - tip.offsetWidth / 2), w.width - tip.offsetWidth)}px`;
    };
    el.querySelectorAll('.bar').forEach((g) => {
      g.addEventListener('mouseenter', () => showTip(g)); g.addEventListener('focus', () => showTip(g));
      g.addEventListener('mouseleave', () => (tip.hidden = true)); g.addEventListener('blur', () => (tip.hidden = true));
    });
  }

  function render() {
    // don't wipe a form the student is typing in
    if (el.contains(document.activeElement) && document.activeElement.matches('input')) {
      const s = el.querySelector('#trackStatus'), live = tracker.status();
      if (s && live) s.textContent = `Tracking · ${fmtMiles(live.meters)} mi · ${fmtInt(live.steps)} steps`;
      return;
    }
    if (acc.user) signedIn(); else signedOut();
  }
  return { render };
}
