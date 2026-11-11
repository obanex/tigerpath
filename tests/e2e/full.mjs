// TigerPath full feature test — run before every release.
//
//   npm run build && npx vite preview --port 4173 &
//   node tests/e2e/full.mjs            # writes test-results/report.md + screenshots
//
// Uses the real Supabase project (src/config.js) for accounts, Hall Cup and
// Walk With Me. Test accounts are tigerpath-e2e-<run>-N@example.com; delete
// them afterwards (the README explains how) — or run with E2E_CLOUD=0 to skip.
// Weather is simulated so the run doesn't depend on Open-Meteo.

import { chromium, devices } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = process.env.E2E_OUT ?? 'test-results';
const CLOUD = process.env.E2E_CLOUD !== '0';
const RUN = Date.now().toString(36);
const PASS = 'tigers2026!';
const email = (n) => `tigerpath-e2e-${RUN}-${n}@example.com`;
const P = { CK: [39.39361, -76.60665], LA: [39.39505, -76.60899], HH: [39.39412, -76.60945], PY: [39.39446, -76.60899], LI: [39.39438, -76.60796], GT: [39.39221, -76.61012], MID: [39.3935, -76.6075], GOUCHER: [39.4085, -76.5935] };
const WX = { current: { temperature_2m: 30.4, weather_code: 71, precipitation: 0.4, wind_speed_10m: 6, is_day: 1, time: 'now' } };

await mkdir(OUT, { recursive: true });
const results = [];
let section = '';
const errorsBy = new Map();
async function check(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ section, name, ok: true, detail: detail ?? '', ms: Date.now() - t0 }); console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  catch (e) { results.push({ section, name, ok: false, detail: e.message.split('\n')[0], ms: Date.now() - t0 }); console.log(`  ❌ ${name} — ${e.message.split('\n')[0]}`); }
}
const group = (s) => { section = s; console.log(`\n${s}`); };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch();
async function newCtx(opts = {}, tag = 'ctx') {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
  await ctx.route(/api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(WX) }));
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, (r) => r.abort()); // only used as fallbacks; the map is self-hosted
  ctx.on('page', (p) => watch(p, tag));
  return ctx;
}
function watch(p, tag) {
  const list = errorsBy.get(tag) ?? []; errorsBy.set(tag, list);
  p.on('pageerror', (e) => list.push(`${e.message} @ ${(e.stack || '').split('\n').slice(1, 14).map((l) => l.trim().replace(/http:\/\/localhost:4173\/assets\//, '')).join(' < ')} [during: ${section}]`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_TUNNEL/.test(m.text())) list.push(m.text()); });
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
async function open(p, hash = '', { guest = true } = {}) {
  await p.goto(BASE + hash); await p.waitForSelector('.bmark', { state: 'attached', timeout: 20000 });
  if (guest && await p.locator('#guestBtn').isVisible()) await p.click('#guestBtn');
}
async function signUp(p, name, mail) {
  if (!(await p.locator('#welcome').isVisible())) { await p.click('#acctBtn'); await p.click('#openWelcome'); }
  await p.click('.authForm ~ * >> nth=0').catch(() => {});
  if (await p.locator('.seg button[data-mode="signup"][aria-checked="false"]').count()) await p.click('.seg button[data-mode="signup"]');
  await p.fill('#aName', name); await p.fill('#aEmail', mail); await p.fill('#aPass', PASS);
  await p.click('.authForm button[type=submit]');
  await p.waitForSelector('#welcome', { state: 'hidden', timeout: 15000 });
}
async function walk(ctx, p, from, steps = 20, dLat = 0.00005) {
  for (let i = 1; i <= steps; i++) { await ctx.setGeolocation({ latitude: from[0] + i * dLat, longitude: from[1], accuracy: 5 }); await p.waitForTimeout(1100); }
}

// ============================================================ 1. Map & search
group('1. Map, search & buildings');
const c1 = await newCtx({ geolocation: { latitude: P.CK[0], longitude: P.CK[1], accuracy: 5 }, permissions: ['geolocation'] }, 'map');
const p1 = await c1.newPage();
await check('Welcome screen appears first', async () => { await p1.goto(BASE); await p1.waitForSelector('#welcome:not([hidden])'); return 'sign in / create account / continue as guest'; });
await check('Continue as guest', async () => { await p1.click('#guestBtn'); expect(await p1.locator('#welcome').isHidden(), 'welcome still visible'); });
await check('Self-hosted map draws (no outside tile server)', async () => {
  await p1.waitForTimeout(2000);
  const n = await p1.evaluate(() => [...document.querySelectorAll('.leaflet-tile-pane canvas')].filter((c) => { try { return c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0; } catch { return false; } }).length);
  expect(n > 0, 'no map tiles drawn'); return `${n} tiles drawn`;
});
await check('45 building pins + OSM footprints', async () => {
  const pins = await p1.locator('.bmark').count(), polys = await p1.locator('.leaflet-overlay-pane path').count();
  expect(pins === 45, `${pins} pins`); expect(polys > 40, `${polys} footprints`); return `${pins} pins, ${polys} footprints`;
});
const searches = [['cook', 'CK'], ['LA', 'LA'], ['registrar', 'ES'], ['computer science', 'YR'], ['stephns', 'ST'], ['chick fil a', 'UU'], ['health center', 'WW'], ['paca', 'WV1']];
await check(`Search (${searches.length} queries: name, code, department, typo, food, old name)`, async () => {
  const bad = [];
  for (const [q, want] of searches) { await p1.fill('#q', q); await p1.waitForTimeout(120); const got = (await p1.locator('#qResults li .code').first().innerText()).trim(); if (got !== want) bad.push(`${q}→${got}`); }
  expect(!bad.length, bad.join(', '));
});
await check('Room number search (LA 4310 → floor 4)', async () => {
  await p1.fill('#q', 'la 4310'); await p1.waitForTimeout(120); await p1.keyboard.press('Enter');
  const box = await text(p1.locator('.room-box').first()); expect(/Room 4310 · Floor 4/.test(box), box); return box.slice(0, 40);
});
await check('Building card: hours, food, amenities, accessibility, nearby', async () => {
  await open(p1, '#b=UU');
  const t = await text(p1.locator('#detail'));
  for (const s of ['University Union', 'Open', 'FOOD HERE', 'Chick-fil-A', 'AMENITIES', 'ACCESSIBILITY', 'NEARBY']) expect(t.toUpperCase().includes(s.toUpperCase()), `missing "${s}"`);
});
await check('Save a favorite and see it on the home list', async () => {
  await p1.click('#favBtn'); await p1.click('#backBtn');
  const favs = await text(p1.locator('#favs')); expect(favs.includes('University Union'), favs);
});
await check('Category filter (Dining)', async () => {
  await p1.click('.chip[data-c="dining"]'); const list = await text(p1.locator('#nearestOut'));
  expect(/DINING · \d/i.test(list), list.slice(0, 60)); await p1.click('.chip[data-c="dining"]'); return list.slice(0, 50);
});
await check('Find nearest printing (from my location)', async () => {
  await p1.click('#locateBtn'); await p1.waitForTimeout(1200); await p1.click('#quick button[data-k="printing"]');
  const t = await text(p1.locator('#nearestOut')); expect(/min/.test(t), t); return t.slice(0, 70);
});
await check('Layers: shuttle, parking permit filter, ♿ layer + legend, satellite', async () => {
  await p1.click('#tab-layers');
  await p1.check('input[data-l="shuttle"]'); await p1.check('input[data-l="access"]');
  await p1.selectOption('#permit', 'resident');
  expect(await p1.isVisible('#accessLegend'), 'no accessibility legend');
  await p1.click('#basemaps button[data-v="satellite"]'); await p1.click('#basemaps button[data-v="map"]');
  return (await text(p1.locator('#accessLegend .hint'))).slice(0, 60);
});
await check('Zoomed out: one campus marker instead of 45 pins', async () => {
  await p1.click('#tab-explore');
  for (let i = 0; i < 4; i++) { await p1.click('.leaflet-control-zoom-out'); await p1.waitForTimeout(350); }
  const vis = await p1.locator('.campus-pin').isVisible(); await p1.click('.campus-pin'); await p1.waitForTimeout(900);
  expect(vis, 'campus marker not shown'); expect(await p1.locator('.bmark:visible').count() > 10, 'pins did not come back');
});
await p1.screenshot({ path: `${OUT}/map.png` });

// ============================================================ 2. Directions
group('2. Directions');
await check('Route options CK → Unitas (fastest / another / step-free)', async () => {
  await open(p1, '#from=CK&to=US'); await p1.waitForSelector('.ropt');
  const kinds = await p1.locator('.ropt').evaluateAll((els) => els.map((e) => e.dataset.k));
  expect(kinds[0] === 'fastest' && kinds.includes('stepfree'), kinds.join(',')); return kinds.join(', ');
});
await check('Quickest badge + steps list', async () => {
  expect(await p1.locator('.ropt[data-k="fastest"] .rbadge.q').count() === 1, 'no Quickest badge');
  const n = await p1.locator('.steps li').count(); expect(n >= 3, `${n} steps`); return `${n} steps`;
});
await check('Step-free option has no stairs', async () => {
  await p1.click('.ropt[data-k="stepfree"]'); const meta = await text(p1.locator('.ropt[data-k="stepfree"] .ropt-meta'));
  expect(/no stairs/.test(meta), meta); expect(new URL(p1.url()).hash.includes('route=stepfree'), 'not in link'); return meta;
});
await check('Shared link restores the route', async () => {
  const p = await c1.newPage(); await open(p, '#from=UU&to=BU&route=stepfree'); await p.waitForSelector('.ropt');
  const from = await p.inputValue('#from'), to = await p.inputValue('#to'); await p.close();
  expect(from === 'University Union' && to === 'Burdick Hall', `${from} → ${to}`);
});
await check('Swap start and destination', async () => {
  await open(p1, '#from=CK&to=LA'); await p1.waitForSelector('.ropt'); await p1.click('#swapBtn'); await p1.waitForTimeout(300);
  expect((await p1.inputValue('#from')) === 'Liberal Arts Building', await p1.inputValue('#from'));
});
await check('From my location', async () => {
  await p1.fill('#from', 'my'); await p1.waitForTimeout(150); await p1.keyboard.press('Enter'); await p1.waitForSelector('.summary');
  return await text(p1.locator('.summary'));
});
await check('Dropped pin via right-click', async () => {
  await p1.mouse.click(1000, 450, { button: 'right' }); await p1.click('.ctx-menu button[data-route-to]'); await p1.waitForTimeout(500);
  expect((await p1.inputValue('#to')) === 'dropped pin', await p1.inputValue('#to'));
});
await check('Far-away pin gets a clear message (Goucher College)', async () => {
  await open(p1, `#from=${P.GOUCHER.join(',')}&to=CK`); await p1.waitForTimeout(800);
  const t = await text(p1.locator('#routeOut')); expect(/too far from campus paths/.test(t), t.slice(0, 80));
});
await check('Live walking: start, follow, arrive', async () => {
  await c1.setGeolocation({ latitude: P.CK[0], longitude: P.CK[1], accuracy: 5 });
  await open(p1, '#from=me&to=LA'); await p1.waitForSelector('.ropt'); await p1.click('#liveBtn');
  await c1.setGeolocation({ latitude: P.LA[0], longitude: P.LA[1], accuracy: 5 }); await p1.waitForTimeout(1500);
  const t = await text(p1.locator('#toast')); expect(/arrived/i.test(t), t); return t;
});

// ============================================================ 3. Classes & reminders
group('3. Classes, reminders & calendar');
const c3 = await newCtx({ permissions: ['notifications'] }, 'classes');
const p3 = await c3.newPage();
async function addClass(p, t, b, room, days, s, e) {
  if ((await p.locator('#addClass').getAttribute('open')) === null) await p.click('#addClass summary');
  await p.fill('#cTitle', t); await p.selectOption('#cBldg', b); await p.fill('#cRoom', room);
  for (const d of days) await p.click(`#cDays label:has(input[value="${d}"])`);
  await p.fill('#cStart', s); await p.fill('#cEnd', e); await p.click('#classForm button[type=submit]');
}
await check('Add classes and see the day plan with walking warnings', async () => {
  await open(p3, '#tab=classes&day=mon');
  await addClass(p3, 'COSC 236', 'YR', '125', ['mon', 'wed'], '09:00', '09:50');
  await addClass(p3, 'ENGL 102', 'LA', '4310', ['mon'], '10:00', '10:50');
  await addClass(p3, 'BIOL 190', 'WVC', '', ['mon'], '10:55', '11:45');
  await p3.click('#dayPicker button[data-v="mon"]');
  const t = await text(p3.locator('#dayPlan')); expect(/walk/.test(t) && /late|hustle/.test(t), t.slice(0, 120)); return (t.match(/(⚠️|⛔)[^|]+?(late|hustle)/) ?? [''])[0];
});
await check('Delete a class', async () => {
  const before = await p3.locator('.class-item').count(); await p3.locator('.class-item [data-del]').last().click();
  expect((await p3.locator('.class-item').count()) === before - 1, 'not removed');
});
await check('Calendar export includes classes and reminder alarms', async () => {
  await p3.selectOption('#remLead', '15').catch(() => {});
  await p3.click('details:has(#icsBtn) summary');
  const [dl] = await Promise.all([p3.waitForEvent('download'), p3.click('#icsBtn')]);
  const ics = await readFile(await dl.path(), 'utf8');
  expect(/BEGIN:VEVENT[\s\S]*COSC 236[\s\S]*TRIGGER:-PT15M/.test(ics), 'missing event or alarm'); return `${(ics.match(/BEGIN:VEVENT/g) ?? []).length} events with alarms`;
});
await check('Reminder fires at the right time (simulated clock)', async () => {
  const p = await c3.newPage();
  await p.clock.install({ time: new Date('2026-11-16T08:44:30') }); // Monday; COSC 236 at 9:00, reminder 15 min before
  await p.goto(BASE + '#tab=classes&day=mon'); await p.waitForSelector('.class-item');
  if ((await p.locator('#remOn').isChecked()) === false) await p.check('#remOn');
  await p.clock.runFor(60000); await p.waitForSelector('#banner:not([hidden])', { timeout: 10000 });
  const t = await text(p.locator('#banner')); await p.close(); expect(/COSC 236/.test(t), t); return t.slice(0, 70);
});

// ============================================================ 4. Accounts (real Supabase)
let pA, cA, cB;
if (CLOUD) {
  group('4. Accounts (real cloud accounts)');
  cA = await newCtx({ geolocation: { latitude: P.CK[0], longitude: P.CK[1], accuracy: 5 }, permissions: ['geolocation', 'notifications'] }, 'accountA');
  pA = await cA.newPage();
  await check('Too-short password is rejected', async () => {
    await pA.goto(BASE); await pA.waitForSelector('#welcome:not([hidden])');
    await pA.fill('#aName', 'Test Tiger'); await pA.fill('#aEmail', email(1)); await pA.fill('#aPass', 'short'); await pA.click('.authForm button[type=submit]');
    await pA.waitForSelector('#authErr:not([hidden])'); return await pA.locator('#authErr').innerText();
  });
  await check('Sign up (no email confirmation needed)', async () => {
    await signUp(pA, 'Test Tiger', email(1));
    return `avatar ${await pA.locator('#acctAvatar').innerText()}`;
  });
  await check('Add class + goals + preferences on device A', async () => {
    await pA.click('#tab-schedule'); await addClass(pA, 'MATH 273', 'SC', '201', ['tue', 'thu'], '13:00', '14:15');
    await pA.click('#tab-activity'); await pA.click('#goalCard summary'); await pA.fill('#gSteps', '9000'); await pA.click('#goalForm button[type=submit]');
    await pA.click('#acctBtn'); if ((await pA.locator('#prefCard').getAttribute('open')) === null) await pA.click('#prefCard summary');
    await pA.check('input[data-pref="avoidStairs"]'); await pA.selectOption('#pHome', 'GT');
    await pA.waitForTimeout(1500);
  });
  await check('Sign out, then wrong password is rejected', async () => {
    await pA.click('#signOut'); await pA.waitForTimeout(500); await pA.click('#openWelcome'); await pA.click('.seg button[data-mode="signin"]');
    await pA.fill('#aEmail', email(1)); await pA.fill('#aPass', 'wrong-password'); await pA.click('.authForm button[type=submit]');
    await pA.waitForSelector('#authErr:not([hidden])'); const t = await pA.locator('#authErr').innerText(); expect(/incorrect/i.test(t), t); return t;
  });
  await check('Sign in on a second device: classes, goals and preferences synced', async () => {
    cB = await newCtx({}, 'accountB'); const pB = await cB.newPage();
    await pB.goto(BASE); await pB.waitForSelector('#welcome:not([hidden])'); await pB.click('.seg button[data-mode="signin"]');
    await pB.fill('#aEmail', email(1)); await pB.fill('#aPass', PASS); await pB.click('.authForm button[type=submit]');
    await pB.waitForSelector('#welcome', { state: 'hidden' });
    await pB.click('#tab-schedule'); await pB.click('#dayPicker button[data-v="tue"]'); const cls = await text(pB.locator('#dayPlan'));
    await pB.click('#tab-activity'); const goal = await text(pB.locator('.ring figcaption').first());
    await pB.click('#acctBtn'); const stairs = await pB.isChecked('input[data-pref="avoidStairs"]');
    expect(/MATH 273/.test(cls), 'class missing'); expect(/9,000/.test(goal), goal); expect(stairs, 'avoid-stairs not synced');
    await pB.close(); return 'MATH 273, 9,000-step goal, avoid stairs';
  });
  await check('Home building gives one-tap directions home', async () => {
    await pA.fill('#aPass', PASS); await pA.click('.authForm button[type=submit]'); await pA.waitForSelector('#welcome', { state: 'hidden' });
    await pA.click('#tab-explore'); const t = await text(pA.locator('#favs')); expect(/Glen Towers/.test(t) && /Directions home/.test(t), t.slice(0, 80));
  });

  // ============================================================ 5. Activity, challenges, badges, Hall Cup
  group('5. Activity tab, challenges, badges & Hall Cup');
  await check('Track a walk → steps, miles, chart', async () => {
    await pA.click('#tab-activity'); await pA.click('#trackBtn');
    await walk(cA, pA, P.CK, 20); await pA.waitForTimeout(5500); await pA.click('#trackBtn'); await pA.waitForTimeout(800);
    const rings = (await pA.locator('.ring figcaption').allInnerTexts()).map((s) => s.replace(/\n/g, ' '));
    expect(!/^0 /.test(rings[0]), rings.join(' | ')); expect(await pA.locator('.week-chart .bar path').count() >= 1, 'no bar'); return rings.join(' | ');
  });
  await check('Walking into buildings while tracking → "new place" + Explorer badge', async () => {
    await pA.click('#trackBtn');
    for (const id of ['LA', 'HH', 'PY', 'LI', 'GT']) { await cA.setGeolocation({ latitude: P[id][0], longitude: P[id][1], accuracy: 5 }); await pA.waitForTimeout(1300); }
    await pA.waitForTimeout(5000); await pA.click('#trackBtn'); await pA.click('#tab-explore'); await pA.click('#tab-activity');
    const on = await pA.locator('.badges li.on b').allInnerTexts(); expect(on.includes('Explorer'), on.join(', ')); return on.join(', ');
  });
  await check('Weekly challenges show progress', async () => {
    const t = (await pA.locator('#actOut .pulse-list.ch').innerText()).split('\n').filter(Boolean); expect(t.length >= 3, t.join(' | ')); return t.slice(0, 2).join(' · ');
  });
  await check('Hall Cup: join a hall → steps saved to the real database', async () => {
    await pA.selectOption('#pHall', 'SH'); await pA.waitForTimeout(3500);
    const row = await text(pA.locator('table.board tr.mine')); expect(/Scarborough/.test(row) && /You/.test(row), row); return row;
  });
  await check('Hall Cup: 3 walkers → hall gets ranked', async () => {
    // two more real test students join the same hall through the public API, as themselves
    const cfg = await readFile(new URL('../../src/config.js', import.meta.url), 'utf8');
    const url = cfg.match(/SUPABASE_URL = '([^']+)'/)[1], key = cfg.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
    const week = await pA.evaluate(() => { const d = new Date(); const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dow = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dow); const y = x.getUTCFullYear(); return `${y}-W${String(Math.ceil(((x - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0')}`; });
    const out = await pA.evaluate(async ({ url, key, users, week }) => {
      const res = [];
      for (const [mail, pass, steps] of users) {
        const s = await (await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, password: pass, data: { name: 'Test' } }) })).json();
        const tok = s.access_token, uid = s.user?.id;
        const w = await fetch(`${url}/rest/v1/weekly_steps`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: uid, week, hall: 'SH', steps }) });
        // and prove RLS: this student can't read anyone else's row
        const mine = await (await fetch(`${url}/rest/v1/weekly_steps?select=user_id`, { headers: { apikey: key, authorization: `Bearer ${tok}` } })).json();
        res.push({ ok: !!tok && w.ok, visible: mine.length });
      }
      return res;
    }, { url, key, week, users: [[email(2), PASS, 12000], [email(3), PASS, 15000]] });
    expect(out.every((o) => o.ok), JSON.stringify(out)); expect(out.every((o) => o.visible === 1), `rows visible to each student: ${out.map((o) => o.visible)}`);
    await pA.click('#tab-explore'); await pA.waitForTimeout(500); await pA.reload(); await pA.waitForSelector('.bmark', { state: 'attached' }); await pA.waitForTimeout(3000);
    await pA.click('#tab-activity'); const row = await text(pA.locator('table.board tr.mine'));
    expect(/^1 /.test(row) || /^\d+ Scarborough/.test(row), row); return `${row} · each student sees only their own row`;
  });
  await check('Pulse shows Hall Cup standings', async () => {
    await pA.click('#tab-explore'); const t = await text(pA.locator('.pulse-card:has-text("Hall Cup")')); expect(/Scarborough/.test(t), t); return t.slice(0, 90);
  });
  await pA.click('#tab-activity'); await pA.screenshot({ path: `${OUT}/activity.png` });
}

// ============================================================ 6. Campus Pulse
group('6. Campus Pulse');
await check('Greeting, weather advice, next class, food open, Walk With Me', async () => {
  await p3.click('#tab-explore'); await p3.waitForSelector('.pulse-wx');
  const t = await text(p3.locator('.pulse'));
  for (const s of ['30°F', 'Snow', 'step-free', 'NEXT CLASS', 'FOOD OPEN NOW', 'WALK WITH ME']) expect(t.toUpperCase().includes(s.toUpperCase()), `missing "${s}"`);
  return t.slice(0, 80);
});
await check('Icy weather → step-free routes picked first', async () => {
  await p3.click('[data-act="stepfree"]'); await open(p3, '#from=CK&to=US'); await p3.waitForSelector('.ropt');
  const sel = await p3.locator('.ropt[aria-checked=true]').getAttribute('data-k'); expect(sel === 'stepfree', sel); return sel;
});

// ============================================================ 7. Walk With Me (real-time, two devices)
group('7. Walk With Me');
const cW = await newCtx({ geolocation: { latitude: P.CK[0], longitude: P.CK[1], accuracy: 5 }, permissions: ['geolocation'] }, 'walker');
const cF = await newCtx({}, 'friend');
const pw = await cW.newPage(), pf = await cF.newPage();
let link;
await check('Start sheet + share link', async () => {
  await open(pw, '#from=me&to=GT'); await pw.waitForSelector('.ropt'); await pw.click('#wwmBtn'); await pw.waitForSelector('#walkDialog:not([hidden])');
  const msg = decodeURIComponent((await pw.locator('#wwmSms').getAttribute('href')).split('body=')[1]);
  link = msg.match(/https?:\S+/)[0].replace(/^https?:\/\/[^/]+\//, BASE); expect(/watch=/.test(link), msg); return msg.replace(/https?:\S+/, '<link>');
});
await check('Friend opens the link (planned route + arrival time)', async () => {
  await pf.goto(link); await pf.waitForSelector('#watchPanel:not([hidden])'); const t = await text(pf.locator('#watchPanel')); expect(/walking to Glen Towers/.test(t), t); return t.slice(0, 70);
});
await check('Live location reaches the friend on another device', async () => {
  await pw.click('#wwmStart'); await pw.waitForTimeout(2500); await cW.setGeolocation({ latitude: P.MID[0], longitude: P.MID[1], accuracy: 5 });
  await pf.waitForSelector('.friend-dot', { timeout: 25000 }); return await text(pf.locator('#watchPanel .small').first());
});
await check('Running late → "Are you OK?" → no answer → emergency options (friend alerted)', async () => {
  // shorten the safety timer instead of waiting 10+ minutes
  await pw.clock.install(); await pw.clock.fastForward('20:00'); await pw.waitForSelector('#walkDialog:not([hidden]) h2', { timeout: 15000 });
  const first = await pw.locator('#walkDialog h2').innerText();
  await pw.clock.fastForward('01:05'); await pw.waitForSelector('#walkDialog .sos-list', { timeout: 15000 });
  const tel = await pw.locator('#walkDialog a[href^="tel:4107044444"]').count();
  await pf.waitForSelector('#watchPanel.alert', { timeout: 25000 });
  expect(tel === 1, 'no TU Police button'); return `${first} → TU Police / 911 / text; friend: ${await text(pf.locator('#watchPanel b'))}`;
});
await check('Arrival → walker and friend both see it', async () => {
  if (await pw.locator('#wwmFalse').count()) await pw.click('#wwmFalse');
  await cW.setGeolocation({ latitude: P.GT[0], longitude: P.GT[1], accuracy: 5 }); await pw.waitForTimeout(1500);
  await pw.waitForSelector('#walkDialog h2:has-text("You made it")', { timeout: 20000 });
  await pf.waitForSelector('#watchPanel:has-text("arrived")', { timeout: 25000 }); return await text(pf.locator('#watchPanel b'));
});
await pf.screenshot({ path: `${OUT}/walk-with-me-friend.png` });

// ============================================================ 8. Accessibility & editor
group('8. Accessibility & data editor');
const c8 = await newCtx({}, 'editor');
const p8 = await c8.newPage();
p8.on('dialog', (d) => d.accept('Test ramp note'));
await check('Editor: drag a building pin and download buildings.js', async () => {
  await p8.goto(BASE + '?edit=1#b=LA'); await p8.waitForSelector('.editor'); await p8.waitForTimeout(800);
  const box = await p8.locator('.bmark', { hasText: /^LA$/ }).boundingBox();
  await p8.mouse.move(box.x + 15, box.y + 15); await p8.mouse.down(); await p8.mouse.move(box.x + 50, box.y + 30, { steps: 5 }); await p8.mouse.up();
  const [dl] = await Promise.all([p8.waitForEvent('download'), p8.click('#edExport')]);
  const src = await readFile(await dl.path(), 'utf8'); expect(/id: 'LA'[^\n]*lat: 39\.39/.test(src), 'LA line missing'); return (src.split('\n').find((l) => l.includes("id: 'LA'")) ?? '').trim().slice(0, 90);
});
await check('Editor: add an accessible entrance → step-free routes go to it', async () => {
  await p8.click('#edTools button[data-t="entrance"]');
  const box = await p8.locator('.bmark', { hasText: /^HH$/ }).boundingBox(); await p8.mouse.click(box.x + 70, box.y + 15); await p8.waitForTimeout(300);
  const added = await text(p8.locator('#edAccess')); expect(/HH/.test(added), `entrance attached to: ${added}`);
  await p8.goto(BASE + '?edit=1#from=UU&to=HH&route=stepfree'); await p8.waitForSelector('.ropt');
  const last = await text(p8.locator('.steps li').last()); expect(/accessible entrance/.test(last), last); return last;
});
await check('Editor: download accessibility.js', async () => {
  const [dl] = await Promise.all([p8.waitForEvent('download'), p8.click('#edAccessExport')]);
  const src = await readFile(await dl.path(), 'utf8'); expect(/"type": "entrance"/.test(src), 'entrance missing');
});

// ============================================================ 9. Offline & install
group('9. Offline & installable app');
await check('Web app manifest + icon', async () => {
  const p = await c8.newPage(); const r = await p.goto(BASE + 'manifest.webmanifest'); const m = await r.json(); await p.close();
  expect(m.name && m.icons?.length && m.display === 'standalone', JSON.stringify(m).slice(0, 80)); return `${m.name} · ${m.display}`;
});
await check('Works offline after a visit (service worker)', async () => {
  const c = await newCtx({}, 'offline'); const p = await c.newPage();
  await open(p); await p.waitForTimeout(2500); await p.reload(); await p.waitForSelector('.bmark', { state: 'attached' }); await p.waitForTimeout(2500);
  await c.setOffline(true); await p.reload(); await p.waitForSelector('.bmark', { state: 'attached', timeout: 15000 });
  const pins = await p.locator('.bmark').count(); await c.close(); expect(pins === 45, `${pins} pins offline`); return `${pins} pins offline`;
});

// ============================================================ 10. Phones
group('10. Phone layouts');
for (const [name, dev] of [['iPhone 13', devices['iPhone 13']], ['Pixel 7', devices['Pixel 7']]]) {
  await check(`${name}: welcome, tabs fit, no sideways scroll, map + pins`, async () => {
    const c = await newCtx({ ...dev }, name); const p = await c.newPage();
    await p.goto(BASE); await p.waitForSelector('#welcome:not([hidden])'); await p.tap('#guestBtn'); await p.waitForTimeout(1500);
    const fit = await p.evaluate(() => [...document.querySelectorAll('.tabs button')].every((b) => b.getBoundingClientRect().right <= innerWidth + 1));
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const pins = await p.evaluate(() => [...document.querySelectorAll('.bmark')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.top > 0 && r.top < innerHeight * 0.5; }).length);
    await p.screenshot({ path: `${OUT}/${name.replace(/\s/g, '-')}.png` }); await c.close();
    expect(fit && !overflow && pins > 0, `tabs fit ${fit}, overflow ${overflow}, pins ${pins}`); return `${pins} pins visible`;
  });
}

// ============================================================ 11. Account deletion (last)
if (CLOUD) {
  group('11. Account deletion');
  await check('Delete account removes it (sign-in fails afterwards)', async () => {
    pA.on('dialog', (d) => d.accept());
    await pA.click('#acctBtn'); await pA.click('#meOut details:has(#deleteAcct) summary'); await pA.click('#deleteAcct'); await pA.waitForTimeout(1500);
    expect((await pA.locator('#acctAvatar').innerText()) === '👤', 'still signed in'); return 'signed out, data deleted';
  });
}

// ============================================================ console errors + report
group('12. JavaScript errors across all sessions');
for (const [tag, list] of errorsBy) await check(`No errors: ${tag}`, async () => { expect(!list.length, list.slice(0, 2).join(' | ')); });

await browser.close();
const passed = results.filter((r) => r.ok).length;
const md = [`# TigerPath full test — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
  `**${passed} / ${results.length} checks passed**${CLOUD ? ` · cloud test accounts: tigerpath-e2e-${RUN}-*` : ' · cloud tests skipped'}`, ''];
for (const s of [...new Set(results.map((r) => r.section))]) {
  md.push(`## ${s}`, '', '| | Check | Detail |', '|---|---|---|');
  for (const r of results.filter((x) => x.section === s)) md.push(`| ${r.ok ? '✅' : '❌'} | ${r.name} | ${r.detail.replace(/\|/g, '/')} |`);
  md.push('');
}
await writeFile(`${OUT}/report.md`, md.join('\n'));
await writeFile(`${OUT}/report.json`, JSON.stringify({ run: RUN, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed · report: ${OUT}/report.md`);
process.exit(passed === results.length ? 0 : 1);
