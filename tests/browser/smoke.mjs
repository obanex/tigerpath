// Cross-browser smoke test: loads the built site on phone-sized WebKit (iPhone Safari)
// and Chromium (Android Chrome), checks the map and building pins render, and
// reports any JavaScript errors. Run by .github/workflows/browser-tests.yml.
//
//   npm run build && npx vite preview --port 4173 & node tests/browser/smoke.mjs

import { chromium, webkit, devices } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/';
const OUT = process.env.SMOKE_OUT ?? 'smoke-results';
const targets = [
  { name: 'iphone-webkit', engine: webkit, device: devices['iPhone 13'] },
  { name: 'android-chromium', engine: chromium, device: devices['Pixel 7'] },
];
const only = process.env.SMOKE_ONLY;
await mkdir(OUT, { recursive: true });

let failed = false;
for (const t of targets.filter((t) => !only || t.name.includes(only))) {
  const browser = await t.engine.launch();
  const ctx = await browser.newContext({ ...t.device });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  const report = { target: t.name, steps: {} };
  const snapshot = async (label) => {
    await page.waitForTimeout(2500);
    report.steps[label] = await page.evaluate(() => {
      const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
      const map = document.querySelector('#map');
      const lm = window.__tigerpath?.map;
      return {
        viewport: [innerWidth, innerHeight],
        mapSize: map ? [map.clientWidth, map.clientHeight] : null,
        center: lm ? [lm.getCenter().lat.toFixed(5), lm.getCenter().lng.toFixed(5), lm.getZoom()] : null,
        pinsInView: [...document.querySelectorAll('.bmark')].filter(inView).length,
        pinsTotal: document.querySelectorAll('.bmark').length,
        mapCanvases: [...document.querySelectorAll('.leaflet-tile-pane canvas')].length,
        canvasesWithPixels: [...document.querySelectorAll('.leaflet-tile-pane canvas')].filter((c) => {
          try { const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3] > 0; } catch { return false; }
        }).length,
        campusPinVisible: !!document.querySelector('.campus-pin') && getComputedStyle(document.querySelector('.campus-pin')).display !== 'none',
      };
    });
    const shot = await page.screenshot({ type: 'jpeg', quality: 45, scale: 'css' });
    await writeFile(`${OUT}/${t.name}-${label}.jpg`, shot);
  };
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('.bmark', { state: 'attached', timeout: 20000 });
    await snapshot('load');
    await page.tap('.chip[data-c="academic"]');
    await snapshot('academic');
  } catch (e) { errors.push(`test: ${e.message.split('\n')[0]}`); }
  report.errors = errors;
  const s = report.steps;
  const ok = errors.filter((e) => !e.startsWith('requestfailed')).length === 0 && s.load?.pinsInView > 0 && s.load?.canvasesWithPixels > 0 && s.academic?.pinsInView > 0;
  report.ok = ok; failed ||= !ok;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
process.exit(failed ? 1 : 0);
