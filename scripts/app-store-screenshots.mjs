#!/usr/bin/env node
// App Store screenshots (6.9" iPhone: 1320 × 2868) of TU TigerPath in demo mode,
// on a Monday morning before class.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/app-store-screenshots.mjs        → docs/app-store-screenshots/*.png

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.SHOTS_URL ?? 'http://127.0.0.1:4173/';
const OUT = 'docs/app-store-screenshots';
const WX = { current: { temperature_2m: 54, weather_code: 1, precipitation: 0, wind_speed_10m: 5, is_day: 1, time: 'now' } };
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  timezoneId: 'America/New_York', colorScheme: 'light',
  geolocation: { latitude: 39.39221, longitude: -76.61012, accuracy: 5 }, permissions: ['geolocation'],
});
await ctx.route(/api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(WX) }));
const HIDE = '#demoBar,#toast{display:none!important} .leaflet-control-attribution{opacity:.85}';

async function page(hash, { sheet = 'half', wait = 1200 } = {}) {
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-11-16T13:41:00Z') }); // Monday 8:41 am in Towson…
  await p.clock.resume(); // …with time running normally, so the map draws
  await p.goto(`${BASE}?demo${hash}`);
  await p.waitForSelector('.bmark', { state: 'attached', timeout: 20000 });
  await p.addStyleTag({ content: HIDE });
  await p.waitForTimeout(wait);
  if (sheet) await p.evaluate((s) => { document.querySelector('#panel').dataset.sheet = s; }, sheet);
  return p;
}
const shot = async (p, name) => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(`  ${name}.png`); await p.close(); };

// 1. Campus Pulse: good morning, next class, leave-by time, weather, food open
{ const p = await page(''); await p.evaluate(() => window.__tigerpath.map.setView([39.3935, -76.6085], 16.5)); await shot(p, '1-pulse'); }

// 2. Route choices side by side
{ const p = await page('#from=GT&to=LA'); await p.waitForSelector('.ropt'); await shot(p, '2-routes'); }

// 3. Turn-by-turn navigation (demo mode walks the route)
{ const p = await page('#from=CK&to=LA', { sheet: null }); await p.waitForSelector('.ropt'); await p.click('#liveBtn');
  await p.waitForSelector('#navHud:not([hidden])'); await p.waitForTimeout(6500); await shot(p, '3-navigation'); }

// 4. Step-free: building card with accessible entrances
{ const p = await page('#b=LA', { sheet: 'full' });
  await p.locator('#detail h2.h', { hasText: 'Accessibility' }).scrollIntoViewIfNeeded(); await shot(p, '4-accessible'); }

// 5. Class day plan with walking times
{ const p = await page('#tab=classes&day=mon', { sheet: 'half' }); await shot(p, '5-classes'); }

// 6. Activity: steps, streak, Hall Cup
{ const p = await page('#tab=activity', { sheet: 'full' }); await shot(p, '6-activity'); }

// 7. Self-guided tour
{ const p = await page('#tour=3', { sheet: 'half', wait: 1800 }); await shot(p, '7-tour'); }

await browser.close();
console.log(`Saved to ${OUT}/`);
