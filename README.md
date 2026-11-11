# TigerPath — Towson University campus navigation

A campus map and wayfinding app for Towson University.

## Features

| Feature | What it does |
|---|---|
| Walking directions | Turn-by-turn steps with walking time and arrival time |
| Accessible routing | Avoids stairs, raised curbs and paths marked not wheelchair-accessible; prefers ramps and curb cuts; slower pace for time estimates |
| Well-lit night routing | Prefers lit paths and paths near emergency phones |
| Search | Buildings, codes, departments, offices, aliases, typos and **room numbers** (`LA 4310` → Liberal Arts, floor 4) |
| Find nearest | Food open now, printing, study space, restrooms, accessible entrances and parking, ranked by real walking time |
| Class schedule planner | Add classes, see each day's route, flags transitions you can't make on time, export to calendar (.ics) |
| Live walking mode | Follows GPS, reroutes when you go off course, tells you when you've arrived |
| Open/closed status | Live "Open · closes 9pm" with weekly hours |
| Shareable links | Every building, route and schedule day has its own URL |
| Map layers | Parking (filter by permit), shuttle, emergency phones/AEDs, building footprints, satellite |
| Mobile | Bottom-sheet layout, installable to the home screen, works offline for areas you've viewed |
| Accessibility of the app itself | Dark mode, keyboard navigation and screen-reader support |
| Student accounts | On-device now, or cloud sync with Supabase (see below) |
| Step & mile goals | Daily goals, progress rings, streaks and a 7-day chart; counts walks around campus |
| Class reminders | Students choose how early; can add walking time from the previous class |
| Accessible trails layer | Step-free paths, stairs and curbs to avoid, rough surfaces, curb cuts, accessible parking, ramps/elevators/entrances |
| Data editor for staff | Drag pins on satellite imagery and add accessibility features, then download the updated data file |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (routing, search, hours, schedule, OSM import, editor, accounts, activity, reminders)
npm run build      # static site in dist/ — host anywhere (towson.edu, GitHub Pages, Netlify…)
```

### Deploying

Every push to `main` runs the tests, builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Data sources & what still needs checking

**From OpenStreetMap (refreshed monthly by the *Fetch OpenStreetMap data* workflow):** building footprints and
positions, 14,000+ walkway segments with stairs, lighting and wheelchair tags, 110 emergency phones and AEDs, parking
areas, and food places. Many campus footprints were traced from TU engineering drawings. The workflow saves each
download to the `osm-data` branch; copy `public/data/osm-campus.json` from there into `main` to update the app.

**Still needs checking against current university info:**
- **Hours** are placeholders, marked `verified: false`; the app labels them "sample hours — verify".
- **The shuttle route is a sample.** Replace `SHUTTLES` in `src/data/places.js` with real routes (or a GTFS feed).
- **Departments and parking permit types** should be confirmed with TU.
- **Smith Hall** is flagged as under renovation. Remove the `note` once it reopens.

To fine-tune any pin, open the site with `?edit=1`, switch to **Satellite**, drag the pin, click **Download buildings.js**
and replace `src/data/buildings.js`.

Improving OSM (for example tagging `lit=yes`, `wheelchair=*` and `highway=steps` around campus) directly improves
TigerPath's ♿ and 🌙 routing. A Towson GIS class or mapathon would be a good way to do it.

## Accounts

Students create an account in the **Me** tab. Their classes, saved places, goals, activity and reminder
settings follow the account. Anything they did before signing up comes with them.

- **On-device (default):** works with no server. Passwords are salted and hashed (PBKDF2) and never leave the phone,
  but the account only exists on that device.
- **Cloud (recommended for launch):** real accounts that sync across devices.
  1. Create a free project at [supabase.com](https://supabase.com).
  2. In its SQL editor, run `supabase/schema.sql`. Row-level security means each student can only read their own data.
  3. Put the project URL and **anon public** key in `src/config.js` (Project Settings → API) and push.
     The anon key is meant to be public.
  4. Optional: under Authentication → Providers, restrict sign-ups to `@students.towson.edu` / `@towson.edu`,
     or set up Towson single sign-on.

## Activity tracking — what it can and can't do

- **Distance** comes from GPS while tracking (or while using **Start walking** directions). Bad fixes, standing-still
  jitter and vehicle speeds are filtered out, and on-campus miles are counted separately.
- **Steps** come from the phone's motion sensor when the browser allows it. Otherwise they're estimated from distance
  and the student's height.
- **Web apps can't count steps in the background.** Phones pause them when the screen is off, so TigerPath keeps the
  screen awake while tracking. All-day step counts would need a native app reading Apple Health or Google Fit.
- Only daily totals are stored, never the route walked.

## Class reminders — what it can and can't do

Students choose how early to be reminded (0–60 min), optionally plus the walk from their previous class
("leave by 9:49"). TigerPath notifies them while it's open or installed to the home screen. For reminders when the app
is closed, **Export to calendar** adds the same alarm to every class in their calendar app. Fully server-sent push
reminders would need a small backend (for example a Supabase Edge Function with Web Push).

## Accessibility data

The ♿ layer (Layers tab, also switched on automatically for ♿ routes) shows step-free footpaths, stairs and raised curbs
to avoid, rough surfaces, curb cuts and accessible parking from OpenStreetMap. Accessible routing never uses stairs,
raised curbs or paths marked not wheelchair-accessible. It prefers ramps and curb cuts, and can optionally avoid steep or
rough paths too.

**Gap:** OpenStreetMap has **no ramps, elevators or accessible entrances** mapped for Towson yet. Add them with the
editor (`?edit=1` → Accessibility tools: click the map, add a note, then **Download accessibility.js** and replace
`src/data/accessibility.js`). Once a building has an accessible entrance listed, ♿ routes go to that door instead of the
building's center. This is best done with Accessibility & Disability Services and checked in person, using TU's
[official accessibility map](https://www.towson.edu/maps/documents/campus-map_accessibility.pdf) as a guide.

## Project layout

```
src/
  data/buildings.js   buildings, categories, amenities, hours  ← edit me
  data/places.js      parking, shuttles, closures, safety       ← edit me
  lib/graph.js        walking graph, A* routing, routing profiles, turn-by-turn
  lib/search.js       fuzzy search + room-number parsing
  lib/hours.js        open-now / weekly hours
  lib/schedule.js     class planner + .ics export
  data/accessibility.js  ramps, elevators, accessible entrances  ← edit me (or use ?edit=1)
  lib/osm.js          OpenStreetMap → routing graph (+ ramps, curbs, surfaces)
  lib/activity.js     GPS distance filter, step detector, goals, streaks
  lib/reminders.js    when to remind for each class
  lib/account.js      accounts: on-device or Supabase
  ui/editor.js        ?edit=1 data editor (pins + accessibility)
  ui/me.js            Me tab (account, goals, tracking, chart)
  ui/tracker.js       walk tracking (GPS + motion sensor + wake lock)
  ui/notify.js        class reminder notifications
  config.js           Supabase settings (optional)
supabase/schema.sql   cloud accounts table + security rules
  main.js             app UI (Leaflet map, panels, URL state)
scripts/fetch-osm.mjs
public/sw.js          offline support
public/tiles/         self-hosted map tiles (built by the Build self-hosted map workflow)
scripts/build-basemap.mjs  turns a Protomaps extract into tile files
```

Temporary closures go in `CLOSURES` in `src/data/places.js` with an `until` date; routes avoid them until that date.

## Roadmap ideas

- **Indoor maps**: floor plans per building, routing to the room door, elevator locations.
- **Live shuttle arrivals** from TU's shuttle provider (GTFS-Realtime), with "leave by" times.
- **Schedule import** from Towson Online Services instead of typing classes in.
- **Events layer** from the campus events calendar ("what's happening near me").
- **Accessibility reports**: users flag a broken elevator or a blocked ramp, and accessible routing avoids it right away.
- **Study-space occupancy** from library/Union capacity counters.

## The map

The street map is **self-hosted**: `public/tiles` holds vector tiles for greater Towson (Rodgers Forge to Loch Raven, up to the Beltway), cut from
[Protomaps](https://protomaps.com)' free daily OpenStreetMap builds. There's no API key, no tile provider and no usage
limit, and it works offline once loaded. The **Build self-hosted map** workflow refreshes it on the 3rd of each month
(or run it from the Actions tab), commits the new tiles and redeploys. To cover a bigger area, widen `BBOX` in
`.github/workflows/build-basemap.yml`.

Satellite view uses Esri's free World Imagery service, which has no uptime guarantee, so treat it as optional.

Map data © OpenStreetMap contributors. Not an official Towson University product.
