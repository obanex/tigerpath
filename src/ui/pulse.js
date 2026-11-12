// The Explore page under the photo: what matters right now. The greeting, date and weather
// sit on the photo (headEl); below come the next class (with a leave-by time), places to
// discover, food that's open, today's steps, and Walk With Me after dark.

import { upcomingClasses } from '../lib/reminders.js';
import { openStatus, formatTime } from '../lib/hours.js';
import { goalProgress, streak, dayKey } from '../lib/activity.js';
import { describeCode, weatherAdvice, formatTemp } from '../lib/weather.js';
import { isDarkOutside } from '../lib/sun.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const CUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8ZM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M11 3.5v2"/></svg>';
const PLATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><path d="M3 4v16M21 4c-2 1-2 5 0 6v10"/></svg>';
const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8.5 7.5 10 4.3-1.5 7.5-5.3 7.5-10v-6L12 2.5ZM8.5 12l2.5 2.5 4.5-5"/></svg>';

/** One Discover card (small or big): a photo when there is one, else the category color and code. */
export function discoverCard(c, big = false) {
  return `<button class="dcard" style="--cat:${esc(c.color)}" ${c.act ? `data-act="${esc(c.act)}"` : `data-place="${esc(c.id)}"`} aria-label="${esc(c.name)}${c.sub ? `, ${esc(c.sub)}` : ''}">
    ${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" style="object-position:${esc(c.pos ?? '50% 50%')}">` : `${c.shape ?? ''}<span class="dcode" aria-hidden="true">${esc(c.code)}</span>`}
    ${c.chip ? `<span class="gold-chip">${esc(c.chip)}</span>` : ''}
    <span class="dname">${esc(c.name)}${big && c.sub ? `<span class="dsub">${esc(c.sub)}</span>` : ''}</span></button>`;
}
/** Cards laid out three small, then two big, repeating. */
export function discoverRows(cards) {
  let html = '';
  for (let i = 0; i < cards.length; i += 5) {
    const small = cards.slice(i, i + 3), big = cards.slice(i + 3, i + 5);
    if (small.length) html += `<div class="row3">${small.map((c) => discoverCard(c)).join('')}</div>`;
    if (big.length) html += `<div class="row2">${big.map((c) => discoverCard(c, true)).join('')}</div>`;
  }
  return html;
}

/**
 * ctx: { headEl, acc, buildings, byId, weather, units, now, nextClassWalk(cls) -> { minutes, fromLabel, from } | null,
 *        stepFreeToday, discover: [card], photoOf(id) -> { src } | null,
 *        actions: { directionsTo(cls, from), addClasses(), walkWithMe(), signIn(), stepFreeToday(), openAccount(), tour(), openPlace(id), openAll() } }
 */
export function renderPulse(el, ctx) {
  const { acc, weather, now = new Date() } = ctx;
  const name = acc.user?.name?.split(' ')[0];
  const h = now.getHours();
  const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const dark = isDarkOutside(now);
  const parts = [];

  // --- on the photo: date + weather, greeting, and any weather advice
  let wx = '', tip = '';
  if (weather) {
    const d = describeCode(weather.code, weather.isDay);
    const adv = weatherAdvice(weather);
    wx = ` · ${formatTemp(weather.tempF, ctx.units)} ${d.label}`;
    if (adv.tip) tip = `<p class="wx-tip">${esc(adv.tip)}</p>`;
    if (adv.icy && !ctx.stepFreeToday) tip += '<button class="btn small" data-act="stepfree">Use step-free routes today</button>';
    if (adv.icy && ctx.stepFreeToday) tip += '<p class="wx-tip">✓ Step-free routes picked first today.</p>';
  }
  ctx.headEl.innerHTML = `<div class="date">${esc(now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}<span class="pulse-wx">${esc(wx)}</span></div>
    <h2>${greet}${name ? `, ${esc(name)}` : ''}</h2>${tip}`;

  // --- up next
  const next = upcomingClasses(acc.data.schedule, now, 36, acc.data.settings.term)[0];
  parts.push('<h2 class="h">Up next</h2>');
  if (next) {
    const b = ctx.byId.get(next.cls.building);
    const walk = ctx.nextClassWalk(next.cls);
    const today = next.day === dayKey(now);
    const leaveBy = walk ? new Date(next.start - Math.ceil(walk.minutes + 2) * 60000) : null;
    const urgent = leaveBy && leaveBy - now < 10 * 60000 && today;
    const mins = Math.round((next.start - now) / 60000);
    const when = today ? (mins < 60 ? `in ${mins} min` : 'today') : 'tmrw';
    parts.push(`<div class="upnext${urgent ? ' urgent' : ''}">
      <div class="upnext-time"><b>${esc(formatTime(hhmm(next.start)))}</b><span>${when}</span></div>
      <div class="upnext-main"><b>${esc(next.cls.title)}</b>
        <span>${esc(b?.name ?? next.cls.building)}${next.cls.room ? ` ${esc(next.cls.room)}` : ''}${leaveBy ? ` · leave by <b style="display:inline;color:var(--fg)">${formatTime(hhmm(leaveBy))}</b>` : ''}</span></div>
      <button class="go-btn" data-act="nextclass" aria-label="Directions to ${esc(next.cls.title)}">${ARROW}</button></div>`);
  } else {
    parts.push(`<div class="empty-card">Add your schedule to get leave-by times and class reminders.
      <div><button class="btn small primary" data-act="addclasses">Add classes</button></div></div>`);
  }

  // --- discover: three small, two big
  parts.push(`<div class="sec-h"><h2 class="h">Discover</h2><button class="see-all" data-act="all">See all</button></div>
    <div class="discover">${discoverRows(ctx.discover)}</div>`);

  // --- open now (food)
  const food = ctx.buildings.filter((b) => b.category === 'dining' || b.food?.length)
    .map((b) => ({ b, st: openStatus(b.hours, now) })).filter((x) => x.st.open).slice(0, 3);
  parts.push('<h2 class="h">Open now</h2>');
  parts.push(food.length ? `<div class="open-list">${food.map(({ b, st }) => {
    const photo = ctx.photoOf(b.id);
    const coffee = (b.food ?? []).some((f) => /starbucks|dunkin|caf/i.test(f));
    return `<button class="orow" data-place="${esc(b.id)}"><span class="othumb">${photo ? `<img src="${esc(photo.src)}" alt="" loading="lazy">` : coffee ? CUP : PLATE}</span>
      <span class="ogrow"><b>${esc(b.food?.length ? b.food.slice(0, 2).join(' · ') : b.name)}</b><span>${esc(b.food?.length ? b.name : 'Dining hall')}</span></span>
      <span class="until">${esc(st.label.replace('Open · ', '').replace(/^closes /, 'until '))}</span></button>`;
  }).join('')}</div>${food.some((x) => x.b.hours?.verified === false) ? '<p class="unverified">Sample hours — check dining’s site</p>' : ''}`
    : '<p class="hint">Nothing’s open right now.</p>');

  // --- today
  if (acc.user) {
    const p = goalProgress(acc.data.activity[dayKey(now)], acc.data.goals);
    const st = streak(acc.data.activity, acc.data.goals, now);
    const left = Math.max(0, acc.data.goals.steps - p.steps);
    parts.push(`<div class="sec-h"><h2 class="h">Today</h2>${st ? `<span class="streak-chip">${st}-day streak</span>` : ''}</div>
      <button class="link-btn" data-act="account" style="text-decoration:none;color:inherit;width:100%;padding:0">
        <p class="today-steps"><b>${p.steps.toLocaleString()}</b> / ${acc.data.goals.steps.toLocaleString()} steps</p>
        <span class="pbar"><span style="width:${Math.round(p.stepsPct * 100)}%"></span></span>
        <span class="small muted">${left ? `${left.toLocaleString()} steps to your goal` : 'Goal reached today. Nice work!'}</span></button>`);
  } else {
    parts.push(`<h2 class="h">Today</h2><div class="empty-card">Sign in to count your steps, take on weekly challenges and earn badges for exploring campus.
      <div><button class="btn small primary" data-act="signin">Sign in</button></div></div>`);
  }

  // --- after dark: Walk With Me
  if (dark) {
    parts.push(`<button class="night-row" data-act="walk">${SHIELD}<span><b>Walk With Me</b><span>It’s dark out. Share your walk with a friend — we’ll check in if you’re running late.</span></span></button>`);
  }

  el.innerHTML = `<section class="pulse" aria-label="Right now">${parts.join('')}</section>`;
  const onClick = (e) => {
    const place = e.target.closest('[data-place]')?.dataset.place;
    if (place) { ctx.actions.openPlace(place); return; }
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    const act = ctx.actions;
    if (a === 'nextclass') act.directionsTo(next.cls);
    else if (a === 'addclasses') act.addClasses();
    else if (a === 'signin') act.signIn();
    else if (a === 'walk') act.walkWithMe();
    else if (a === 'tour') act.tour();
    else if (a === 'stepfree') act.stepFreeToday();
    else if (a === 'account') act.openAccount();
    else if (a === 'all') act.openAll();
  };
  el.onclick = onClick; ctx.headEl.onclick = onClick;
}
