// Campus Pulse: the first thing on the Explore tab — what matters right now.
// Next class (with a leave-by time), weather + walking advice, what's open,
// today's activity and this week's challenges, and Walk With Me after dark.

import { upcomingClasses } from '../lib/reminders.js';
import { openStatus, formatTime } from '../lib/hours.js';
import { goalProgress, streak, dayKey } from '../lib/activity.js';
import { weeklyChallenges, weekStats, challengeProgress, weekKey } from '../lib/challenges.js';
import { describeCode, weatherAdvice, formatTemp } from '../lib/weather.js';
import { isDarkOutside } from '../lib/sun.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const bar = (pct) => `<span class="pbar"><span style="width:${Math.round(pct * 100)}%"></span></span>`;

/**
 * ctx: { acc, buildings, byId, weather, units, now, nextClassWalk(cls) -> { minutes, fromLabel, from } | null,
 *        stepFreeToday, actions: { directionsTo(cls, from), addClasses(), walkWithMe(), signIn(), stepFreeToday(), openAccount() } }
 */
export function renderPulse(el, ctx) {
  const { acc, weather, now = new Date() } = ctx;
  const name = acc.user?.name?.split(' ')[0];
  const h = now.getHours();
  const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const dark = isDarkOutside(now);
  const parts = [];

  // --- header + weather
  let wx = '';
  if (weather) {
    const d = describeCode(weather.code, weather.isDay);
    const adv = weatherAdvice(weather);
    wx = `<div class="pulse-wx"><span class="wx-now">${d.icon} ${formatTemp(weather.tempF, ctx.units)} · ${esc(d.label)}</span>
      ${adv.tip ? `<span class="wx-tip">${esc(adv.tip)}</span>` : ''}
      ${adv.icy && !ctx.stepFreeToday ? '<button class="btn small" data-act="stepfree">Use step-free routes today</button>' : ''}
      ${adv.icy && ctx.stepFreeToday ? '<span class="wx-tip">✓ Step-free routes picked first today.</span>' : ''}</div>`;
  }
  parts.push(`<div class="pulse-head"><div><h2>${greet}${name ? `, ${esc(name)}` : ''}</h2>
    <span class="muted small">${now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</span></div></div>${wx}`);

  // --- next class
  const next = upcomingClasses(acc.data.schedule, now, 36, acc.data.settings.term)[0];
  if (next) {
    const b = ctx.byId.get(next.cls.building);
    const walk = ctx.nextClassWalk(next.cls);
    const mins = Math.round((next.start - now) / 60000);
    const when = next.day === dayKey(now) ? (mins < 60 ? `in ${mins} min` : `at ${formatTime(hhmm(next.start))}`) : `tomorrow at ${formatTime(hhmm(next.start))}`;
    const leaveBy = walk ? new Date(next.start - Math.ceil(walk.minutes + 2) * 60000) : null;
    const urgent = leaveBy && leaveBy - now < 10 * 60000 && next.day === dayKey(now);
    parts.push(`<div class="pulse-card${urgent ? ' urgent' : ''}"><span class="pc-label">Next class</span>
      <b>${esc(next.cls.title)}</b> <span class="muted">${when}</span>
      <div class="small">${esc(b?.name ?? next.cls.building)}${next.cls.room ? ` · Room ${esc(next.cls.room)}` : ''}</div>
      ${walk ? `<div class="small">${Math.ceil(walk.minutes)} min walk from ${esc(walk.fromLabel)} — <b>leave by ${formatTime(hhmm(leaveBy))}</b></div>` : ''}
      <div class="btn-row"><button class="btn small primary" data-act="nextclass">Directions</button></div></div>`);
  } else {
    parts.push(`<div class="pulse-card"><span class="pc-label">Next class</span>
      <span class="small">Add your schedule to get leave-by times and reminders.</span>
      <div class="btn-row"><button class="btn small" data-act="addclasses">Add classes</button></div></div>`);
  }

  // --- open now (food)
  const food = ctx.buildings.filter((b) => b.category === 'dining' || b.food?.length)
    .map((b) => ({ b, st: openStatus(b.hours, now) })).filter((x) => x.st.open).slice(0, 3);
  parts.push(`<div class="pulse-card"><span class="pc-label">Food open now</span>
    ${food.length ? `<ul class="pulse-list">${food.map(({ b, st }) => `<li><button class="link" data-b="${esc(b.id)}">${esc(b.name)}</button><span class="small muted">${esc(st.label.replace('Open · ', ''))}</span></li>`).join('')}</ul>
      <span class="unverified">Sample hours — check dining's site</span>` : '<span class="small">Nothing open right now.</span>'}</div>`);

  // --- activity + challenges
  if (acc.user) {
    const p = goalProgress(acc.data.activity[dayKey(now)], acc.data.goals);
    const st = streak(acc.data.activity, acc.data.goals, now);
    const ch = challengeProgress(weeklyChallenges(weekKey(now), acc.data.goals), weekStats(acc.data, now));
    parts.push(`<div class="pulse-card"><span class="pc-label">Today</span>
      <div class="small"><b>${p.steps.toLocaleString()}</b> / ${acc.data.goals.steps.toLocaleString()} steps ${st ? ` · 🔥 ${st}-day streak` : ''}</div>${bar(p.stepsPct)}
      <span class="pc-label" style="margin-top:10px">This week's challenges</span>
      <ul class="pulse-list ch">${ch.map((c) => `<li><span>${c.icon} ${esc(c.title)}</span>${c.done ? '<span class="done">✓</span>' : `<span class="small muted">${Math.floor(c.value * 10) / 10}/${c.target}</span>`}${bar(c.pct)}</li>`).join('')}</ul>
      <button class="link-btn" data-act="account">See badges →</button></div>`);
  } else {
    parts.push(`<div class="pulse-card"><span class="pc-label">Challenges & badges</span>
      <span class="small">Sign in to track your steps, take on weekly challenges and earn badges for exploring campus.</span>
      <div class="btn-row"><button class="btn small" data-act="signin">Sign in</button></div></div>`);
  }

  // --- Hall Cup
  if (ctx.hallBoard) {
    const rows = ctx.hallBoard.rows ?? [];
    const top = rows.filter((r) => r.rank).slice(0, 3);
    const mine = rows.find((r) => r.mine);
    const medal = ['🥇', '🥈', '🥉'];
    parts.push(`<div class="pulse-card"><span class="pc-label">🏆 Hall Cup · this week</span>
      ${top.length ? `<ul class="pulse-list">${top.map((r, i) => `<li><span>${medal[i]} ${esc(r.name)}${r.mine ? ' <span class="rbadge q">You</span>' : ''}</span><span class="small muted">${r.avg.toLocaleString()} avg</span></li>`).join('')}</ul>`
        : '<span class="small">No hall has 3 walkers yet this week — rally your floor!</span>'}
      ${mine && !top.includes(mine) ? `<span class="small">${esc(mine.name)}: ${mine.rank ? `#${mine.rank}` : `needs ${mine.needs} more walker${mine.needs > 1 ? 's' : ''}`}</span>` : ''}
      ${!acc.data.settings.hall || acc.data.settings.hallCup === false ? `<button class="link-btn" data-act="${acc.user ? 'account' : 'signin'}">${acc.user ? 'Pick your hall to compete →' : 'Sign in to compete for your hall →'}</button>` : ''}</div>`);
  }

  // --- Walk With Me
  parts.push(`<div class="pulse-card wwm${dark ? ' dark' : ''}"><span class="pc-label">🛡️ Walk With Me</span>
    <span class="small">${dark ? "It's dark out. Share your walk with a friend — we'll check in if you're running late." : 'Share any walk with a friend, with a safety check-in if you\'re running late.'}</span>
    <div class="btn-row"><button class="btn small" data-act="walk">Start a safe walk</button></div></div>`);

  el.innerHTML = `<section class="pulse" aria-label="Campus Pulse">${parts.join('')}</section>`;
  el.onclick = (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    const act = ctx.actions;
    if (a === 'nextclass') act.directionsTo(next.cls);
    else if (a === 'addclasses') act.addClasses();
    else if (a === 'signin') act.signIn();
    else if (a === 'walk') act.walkWithMe();
    else if (a === 'stepfree') act.stepFreeToday();
    else if (a === 'account') act.openAccount();
  };
}
