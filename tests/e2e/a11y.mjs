// TigerPath accessibility check (WCAG 2.2 A/AA) with axe-core, on every screen,
// on a phone and a laptop, in light and dark mode.
//
//   npm run build && npx vite preview --port 4173 &
//   npm run test:a11y               # writes test-results/a11y.md
//
// Exit code 1 if any serious or critical violation is found.

import { chromium, devices } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const OUT = process.env.E2E_OUT ?? 'test-results';
const AXE = await readFile(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const WX = { current: { temperature_2m: 52, weather_code: 2, precipitation: 0, wind_speed_10m: 6, is_day: 1, time: 'now' } };

// Each screen: how to get there from a fresh guest session.
const SCREENS = [
  ['Welcome / sign in', async (p) => { await p.goto(BASE); await ready(p); }],
  ['Explore home (Campus Pulse)', async (p) => { await guest(p); }],
  ['Search results', async (p) => { await guest(p); await p.fill('#q', 'lib'); await p.waitForTimeout(300); }],
  ['Building card', async (p) => { await guest(p, '#b=LA'); await p.waitForTimeout(600); }],
  ['Directions with route options', async (p) => { await guest(p, '#from=CK&to=US'); await p.waitForSelector('.ropt'); }],
  ['Classes', async (p) => { await guest(p, '#tab=classes'); }],
  ['Activity', async (p) => { await guest(p, '#tab=activity'); }],
  ['Layers (with ♿ legend)', async (p) => { await guest(p, '#tab=layers'); const c = p.locator('input[data-l="access"]'); if (!(await c.isChecked())) await c.check(); }],
  ['My account', async (p) => { await guest(p, '#tab=account'); }],
  ['Self-guided tour', async (p) => { await guest(p, '#tour'); await p.waitForTimeout(800); }],
  ['Demo mode: Activity (badges, chart, Hall Cup)', async (p) => { await p.goto(BASE + '?demo#tab=activity'); await ready(p); await p.waitForTimeout(800); }],
  ['Turn-by-turn navigation', async (p) => { await p.context().grantPermissions(['geolocation']); await p.context().setGeolocation({ latitude: 39.39361, longitude: -76.60665, accuracy: 5 });
    await guest(p, '#from=me&to=LA'); await p.waitForSelector('.ropt'); await p.click('#liveBtn'); await p.waitForSelector('#navHud:not([hidden])'); }],
  ['Walk With Me sheet', async (p) => { await guest(p, '#from=CK&to=GT'); await p.waitForSelector('#wwmBtn'); await p.click('#wwmBtn'); await p.waitForTimeout(400); }],
];

async function ready(p) { await p.waitForSelector('.bmark', { state: 'attached', timeout: 20000 }); }
async function guest(p, hash = '') {
  await p.goto(BASE); await ready(p);
  if (await p.locator('#guestBtn').isVisible()) await p.click('#guestBtn');
  if (hash) { await p.goto(BASE + hash); await ready(p); await p.waitForTimeout(500); }
}

const browser = await chromium.launch();
const found = new Map(); // rule id -> { impact, help, url, where: Set, nodes: [] }
const VIEWS = [
  ['phone', { ...devices['iPhone 13'] }],
  ['laptop', { viewport: { width: 1360, height: 900 } }],
];
for (const scheme of ['light', 'dark']) for (const [vname, vopts] of VIEWS) {
  const ctx = await browser.newContext({ ...vopts, colorScheme: scheme });
  await ctx.route(/api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(WX) }));
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, (r) => r.abort());
  for (const [name, go] of SCREENS) {
    const p = await ctx.newPage();
    try {
      await go(p);
      await p.addScriptTag({ content: AXE });
      const res = await p.evaluate(async () => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        // map tiles/canvas and Leaflet's own attribution are third-party; our pins and controls are still checked
        exclude: [['.leaflet-tile-pane'], ['.leaflet-overlay-pane canvas']],
      }));
      // Map pins can sit closer than 24 px at some zoom levels. Every pin has an equivalent
      // control (search, Nearby, lists, the Directions fields), which WCAG 2.5.8 allows.
      for (const v of res.violations) if (v.id === 'target-size') v.nodes = v.nodes.filter((n) => !/leaflet-marker-icon/.test(n.html));
      res.violations = res.violations.filter((v) => v.nodes.length);
      for (const v of res.violations) {
        const f = found.get(v.id) ?? { impact: v.impact, help: v.help, url: v.helpUrl, where: new Set(), nodes: [] };
        f.where.add(`${name} (${vname}, ${scheme})`);
        for (const n of v.nodes) if (f.nodes.length < 60 && !f.nodes.some((x) => x.target === n.target.join(' '))) f.nodes.push({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') });
        found.set(v.id, f);
      }
      console.log(`${res.violations.length ? '⚠️ ' : '✅'} ${name} (${vname}, ${scheme})${res.violations.length ? ' — ' + res.violations.map((v) => `${v.id}[${v.impact}]`).join(', ') : ''}`);
    } catch (e) {
      console.log(`❌ ${name} (${vname}, ${scheme}) — ${e.message.split('\n')[0]}`);
      found.set(`error:${name}`, { impact: 'critical', help: e.message.split('\n')[0], where: new Set([`${name} (${vname}, ${scheme})`]), nodes: [] });
    }
    await p.close();
  }
  await ctx.close();
}
// ---- Keyboard only: welcome → search → building → directions → route, with visible focus throughout
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route(/api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(WX) }));
  const p = await ctx.newPage();
  const fail = (msg) => { found.set(`keyboard:${msg}`, { impact: 'serious', help: `Keyboard: ${msg}`, where: new Set(['Keyboard-only trip (laptop)']), nodes: [] }); console.log(`❌ Keyboard: ${msg}`); };
  const focused = () => p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { id: e.id, tag: e.tagName, visible: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px', inWelcome: !!e.closest('#welcome') }; });
  const tabTo = async (id, max) => { for (let i = 0; i < max; i++) { const f = await focused(); if (f.id === id) return f; if (f.tag !== 'BODY' && !f.visible) fail(`no visible focus on ${f.tag}#${f.id}`); await p.keyboard.press('Tab'); } return null; };
  try {
    await p.goto(BASE); await ready(p);
    if (!(await tabTo('guestBtn', 15))) fail('could not Tab to "Continue as guest"');
    else if ((await focused()).inWelcome !== true) fail('focus left the welcome dialog');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    if ((await focused()).tag === 'BODY') fail('focus lost after closing the welcome screen');
    if (!(await tabTo('q', 12))) fail('search not reachable within 12 Tabs (map pins first?)');
    await p.keyboard.type('liberal arts'); await p.waitForTimeout(300); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
    if (!/Liberal Arts/.test(await p.locator('#detail h2').first().innerText().catch(() => ''))) fail('search result did not open with Enter');
    if (!(await tabTo('dirTo', 12))) fail('Directions button not reachable');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    if ((await focused()).id !== 'from') fail('focus did not move to the start field');
    await p.keyboard.type('cook'); await p.waitForTimeout(300); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
    await p.waitForSelector('.ropt', { timeout: 5000 }).catch(() => fail('no route after choosing a start by keyboard'));
    if (![...found.keys()].some((k) => k.startsWith('keyboard:'))) console.log('✅ Keyboard-only trip: welcome → search → building → directions → route');
  } catch (e) { fail(e.message.split('\n')[0]); }
  await ctx.close();
}
await browser.close();

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rows = [...found.entries()].sort((a, b) => order[a[1].impact] - order[b[1].impact]);
const md = ['# TigerPath accessibility check (axe-core, WCAG 2.2 AA)', '',
  'Screens: ' + SCREENS.map(([n]) => n).join(', ') + ' — each on a phone and a laptop, in light and dark mode.', '',
  'Not counted: map pins closer than 24 px apart (each has an equivalent control: search, lists, Nearby — allowed by WCAG 2.5.8).', '',
  rows.length ? `${rows.length} issue type(s):` : 'No violations found on any screen.', '',
  ...rows.flatMap(([id, f]) => [`## ${id} — ${f.impact}`, f.help + (f.url ? ` ([rule](${f.url}))` : ''), '',
    `Screens: ${[...f.where].join('; ')}`, '', ...f.nodes.map((n) => `- \`${n.target}\` — ${n.summary ?? ''}`), ''])];
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/a11y.md`, md.join('\n'));
const bad = rows.filter(([, f]) => f.impact === 'critical' || f.impact === 'serious');
console.log(`\n${rows.length} issue type(s), ${bad.length} serious/critical · report: ${OUT}/a11y.md`);
process.exit(bad.length ? 1 : 0);
