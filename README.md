# TigerPath — Towson University campus navigation

A campus map and wayfinding app for Towson University, inspired by UMD's TerpNav, with more features.

| | TerpNav | TigerPath |
|---|---|---|
| Click-to-route walking directions + ETA | ✅ | ✅ turn-by-turn, with arrival time |
| Accessible routing (avoid obstacles) | ✅ | ✅ avoids stairs and `wheelchair=no` paths, slower pace for estimates |
| Well-lit night routing | — | ✅ prefers lit paths and paths near emergency phones |
| Search | buildings | buildings, codes, departments, offices, aliases, typos, **room numbers** (`LA 4310` → Liberal Arts, floor 4) |
| "Find nearest" | — | food open now, printing, study space, restrooms, accessible entrances, parking — ranked by real walking time |
| Class schedule planner | — | add classes, see each day's route, flags transitions you can't make on time, export to calendar (.ics) |
| Live walking mode | — | follows GPS, reroutes when you go off course, tells you when you've arrived |
| Open/closed status | — | live "Open · closes 9pm" with weekly hours |
| Shareable links | — | every building, route and schedule day has its own URL |
| Layers | ✅ | parking (filter by permit), shuttle, emergency phones/AEDs, building footprints, satellite |
| Mobile | partial | bottom-sheet UI, installable (PWA), works offline for areas you've viewed |
| Dark mode, keyboard & screen-reader support | — | ✅ |
| Data editor for staff | — | ✅ drag pins on satellite imagery, download the updated data file |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (routing, search, hours, schedule, OSM import, editor)
npm run build      # static site in dist/ — host anywhere (towson.edu, GitHub Pages, Netlify…)
```

### Deploying

Every push to `main` runs the tests, builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). One-time setup: **Settings → Pages → Source: GitHub Actions**.

## ⚠️ Before launch: verify the data

The seed data in `src/data/` was compiled without access to official TU GIS data, so:

- **Building positions are approximate.** Fix them in a few minutes with the editor:
  open `http://localhost:5173/?edit=1`, switch to **Satellite**, drag each pin onto the building's main
  entrance, then click **Download buildings.js** and replace `src/data/buildings.js`.
- **Hours are placeholders**, marked `verified: false`; the app labels them "sample hours — verify".
- **The shuttle route is a sample.** Replace `SHUTTLES` in `src/data/places.js` with real routes (or a GTFS feed).
- **Emergency phones / AEDs are intentionally empty** until loaded from a verified source. The app never invents safety equipment.
- **Departments and parking permits** should be checked against current university listings.

### Real walkways from OpenStreetMap

```bash
npm run fetch-osm
```

This downloads Towson's footpaths, stairs, lighting tags, building footprints, parking and emergency phones from
OpenStreetMap into `public/data/osm-campus.json`. When that file exists the app automatically:
- routes along real sidewalks and paths instead of the approximate building-to-building mesh,
- uses real stairs / lighting / wheelchair tags for the ♿ and 🌙 modes,
- names paths in directions ("Turn left on Cross Campus Drive"),
- draws building footprints and snaps matching building pins to them.

Improving OSM (for example tagging `lit=yes`, `wheelchair=*`, `highway=steps` and `emergency=phone` around campus)
directly improves TigerPath. A Towson GIS class or mapathon would be a good way to do it.

## Project layout

```
src/
  data/buildings.js   buildings, categories, amenities, hours  ← edit me
  data/places.js      parking, shuttles, closures, safety       ← edit me
  lib/graph.js        walking graph, A* routing, routing profiles, turn-by-turn
  lib/search.js       fuzzy search + room-number parsing
  lib/hours.js        open-now / weekly hours
  lib/schedule.js     class planner + .ics export
  lib/osm.js          OpenStreetMap → routing graph
  ui/editor.js        ?edit=1 data editor
  main.js             app UI (Leaflet map, panels, URL state)
scripts/fetch-osm.mjs
public/sw.js          offline support
```

Temporary closures go in `CLOSURES` in `src/data/places.js` with an `until` date; routes avoid them until that date.

## Roadmap ideas

- **Indoor maps**: floor plans per building, routing to the room door, elevator locations.
- **Live shuttle arrivals** from TU's shuttle provider (GTFS-Realtime), with "leave by" times.
- **Schedule import** from Towson Online Services instead of typing classes in.
- **Events layer** from the campus events calendar ("what's happening near me").
- **Accessibility reports**: users flag a broken elevator or a blocked ramp, and accessible routing avoids it right away.
- **Study-space occupancy** from library/Union capacity counters.

Map tiles: © OpenStreetMap contributors, © CARTO, imagery © Esri. Not an official Towson University product.
