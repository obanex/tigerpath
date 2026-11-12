# TU TigerPath — Towson University campus navigation

A campus map and wayfinding app for Towson University.

## Features

| Feature | What it does |
|---|---|
| Welcome screen | Sign in or create an account when the app opens, or continue as a guest |
| Activity tab | Today's steps and miles, walk tracking, 7-day chart, Hall Cup, weekly challenges, badges and goals |
| My account | Profile and **preferences**: preferred route, always avoid stairs, best-lit after dark, walking pace (incl. wheelchair), units, home building, theme |
| Route choices | Every trip shows the options side by side (fastest, another way, step-free, best lit) with time, distance and stairs; the quickest is marked, tap any to follow it |
| Campus Pulse | The Explore tab opens with your next class and a leave-by time, live weather with walking advice (icy → step-free routes), food open now, today's steps and this week's challenges |
| Challenges & badges | Three new challenges every Monday plus 18 badges for steps, streaks and exploring campus; buildings count as visited when you're there with location on |
| Hall Cup | Weekly step leaderboard between residence halls (plus Commuters), ranked by average steps per walker; last week's winner is announced each Monday and everyone who walked for the winning hall earns the **Hall champion** badge (3 wins: **Dynasty**) |
| Walk With Me | Share a walk with a friend; if you're 5+ minutes late it asks "Are you OK?", and no answer brings up TU Police, 911 and text-a-friend buttons. Your friend follows along from a link |
| Self-guided tour | Ten stops from Admissions to the sciences (~2 mi, ~40 min); opens each stop on arrival, read-aloud, step-free option; share `…/#tour` (e.g. as a QR code) to start it. Stops live in `src/data/tour.js` |
| Walking directions | Turn-by-turn steps with walking time and arrival time |
| Accessible routing | Avoids stairs, raised curbs and paths marked not wheelchair-accessible; prefers ramps and curb cuts; slower pace for time estimates |
| Well-lit night routing | Prefers lit paths and paths near emergency phones |
| Search | Buildings, codes, departments, offices, aliases, typos and **room numbers** (`LA 4310` → Liberal Arts, floor 4) |
| Find nearest | Food open now, printing, study space, restrooms, accessible entrances and parking, ranked by real walking time |
| Class schedule planner | Add classes, see each day's route, flags transitions you can't make on time, export to calendar (.ics) |
| Turn-by-turn navigation | Tap **▶ Start**: the map follows you, a banner shows the next turn and the distance to it ("280 ft · Bear right"), a voice says "In 150 feet, turn left" and "Turn left" (mute with 🔊), the walked part turns grey, the bottom shows time left and arrival time, it reroutes when you leave the route and tells you when you've arrived. GPS hiccups don't stop it, and the screen stays on. In demo mode it walks the route for you |
| Open/closed status | Live "Open · closes 9pm" with weekly hours |
| Shareable links | Every building, route and schedule day has its own URL |
| Map layers | Parking (filter by permit), shuttle, emergency phones/AEDs, building footprints, satellite |
| Mobile | Bottom-sheet layout, installable to the home screen, works offline for areas you've viewed |
| Accessibility of the app itself | Dark mode, keyboard navigation and screen-reader support |
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

## Testing before a release

```bash
npm test                                   # unit tests
npm run build && npx vite preview --port 4173 &
npm run test:e2e                           # full feature test → test-results/report.md + screenshots
npm run test:a11y                          # accessibility check → test-results/a11y.md
```

`test:a11y` runs axe-core (WCAG 2.2 A/AA plus best practices) on 11 screens, each on a phone and a laptop in light and
dark mode, then does a keyboard-only trip (welcome → search → building → directions → route) checking that focus is
never lost and always visible. Map pins that sit closer than 24 px are not counted: each has an equivalent control
(search, lists, Nearby), which WCAG 2.5.8 allows. The app also follows the "reduce motion" setting (no map fly-overs).

`test:e2e` drives the real app in a browser: map and search, directions, classes and reminders, real cloud accounts
(sign-up, sync across two devices, deletion), activity tracking, challenges, badges, Hall Cup rankings in the real
database, Campus Pulse, Walk With Me in real time between two browsers, the data editor, offline mode, and phone
layouts. Run with `E2E_CLOUD=0` to skip the cloud parts. It creates accounts named `tigerpath-e2e-…@example.com`;
remove them afterwards in the Supabase SQL editor:

```sql
delete from auth.users where email like 'tigerpath-e2e-%@example.com';
```

GitHub also runs a quick iPhone Safari + Android Chrome check and the accessibility check on every push
(`.github/workflows/browser-tests.yml`).

## Data sources & what still needs checking

**From OpenStreetMap (refreshed monthly by the *Fetch OpenStreetMap data* workflow):** building footprints and
positions, 14,000+ walkway segments with stairs, lighting and wheelchair tags, 110 emergency phones and AEDs, parking
areas, and food places. Many campus footprints were traced from TU engineering drawings. The workflow saves each
download to the `osm-data` branch; copy `public/data/osm-campus.json` from there into `main` to update the app.

**From TU's official campus map (refreshed monthly by the *Fetch TU campus map data* workflow, or `npm run fetch-tu`):**
TU's Center for GIS publishes the layers behind [maps.towson.edu](https://maps.towson.edu/) as public ArcGIS services.
`scripts/fetch-tu.mjs` saves the parts TigerPath uses to `public/data/tu-campus.json`:
- 78 surveyed **accessible entrances** (door type, automatic openers), 162 **stairs**, 270 **rated accessible route**
  segments, 39 **accessible parking** spots and 44 **paratransit stops**
- the six real **shuttle lines** and their stops, replacing the old sample route
- 26 **parking garages and lots** with TU's permit types (Core, Overflow, Resident, Faculty/Staff), space counts,
  visitor and EV spaces
- **construction areas**, the **office/department index** (228 offices, so "registrar" or "financial aid" find the right
  building), all-gender restrooms and lactation rooms, and 15 buildings TigerPath didn't have (Public Safety, the Armory…)

TU marks this data "preliminary, under review" and publishes it "as is". The app credits it and links to TU's map. Ask TU's
Center for GIS (CGIS@towson.edu) before relying on it officially; they are also the right people to report errors to.
Without the file, the app falls back to its own sample data in `src/data/places.js`.

**Still needs checking against current university info:**
- **Hours** are placeholders, marked `verified: false`; the app labels them "sample hours — verify".
- **Smith Hall** is flagged as under renovation. Remove the `note` once it reopens.

To fine-tune any pin, open the site with `?edit=1`, switch to **Satellite**, drag the pin, click **Download buildings.js**
and replace `src/data/buildings.js`.

Improving OSM (for example tagging `lit=yes`, `wheelchair=*` and `highway=steps` around campus) directly improves
TigerPath's ♿ and 🌙 routing. A Towson GIS class or mapathon would be a good way to do it.

## iPhone app

`ios/` is the App Store version, made with [Capacitor](https://capacitorjs.com) from the same code. On an iPhone it adds
class reminders as real notifications (even when the app is closed), steps from the iPhone's step counter, and turn-by-turn
directions that keep going with the phone locked (`src/native.js`; on the website those calls do nothing).
The **iPhone app** workflow compiles it on a GitHub Mac on every push, and signs and uploads it to TestFlight once the App
Store Connect secrets are set. Everything needed to publish it — Apple account steps, listing text, privacy answers,
reviewer notes — is in **[docs/APP_STORE.md](docs/APP_STORE.md)**. Privacy policy: `public/privacy.html`; support page:
`public/support.html`.

## Demo mode (for presentations)

Open **[obanex.github.io/tigerpath/?demo](https://obanex.github.io/tigerpath/?demo)** (or `#demo`) to show TigerPath with
a sample freshman, Jordan: a class schedule with a tight transition, three weeks of walking with a goal streak, visited
buildings, earned badges, this week's challenges and a Hall Cup where Jordan's hall (Glen Towers) won last week.
No sign-up needed. Nothing is saved: the demo account lives in memory (`src/lib/demo.js`), never calls the cloud
database and never touches the visitor's own TigerPath data. A bar at the top says it's a demo and links back out.

## Accounts

Students sign in or create an account on the welcome screen (or later from the account button in the header). Their classes, saved places, goals, activity and reminder
settings follow the account. Anything they did before signing up comes with them.

- **On-device (default):** works with no server. Passwords are salted and hashed (PBKDF2) and never leave the phone,
  but the account only exists on that device.
- **Cloud (live now):** TigerPath is connected to the Supabase project `tigerpath` (`src/config.js`), so accounts sync
  across devices and Walk With Me friends see live location. Email confirmation is **on**, and Supabase's built-in
  mailer only sends about 2 emails per hour — before a wide launch, either connect a real email service
  (Authentication → Emails → SMTP) or turn confirmation off (Authentication → Sign In / Providers → Email →
  "Confirm email"). To set up a different project yourself:
  1. Create a free project at [supabase.com](https://supabase.com).
  2. In its SQL editor, run `supabase/schema.sql`. Row-level security means each student can only read their own data.
  3. Put the project URL and **anon public** key in `src/config.js` (Project Settings → API) and push.
     The anon key is meant to be public.
  4. Optional: under Authentication → Providers, restrict sign-ups to `@students.towson.edu` / `@towson.edu`,
     or set up Towson single sign-on.

## Activity tracking — what it can and can't do

- **Distance** comes from GPS while tracking (or while navigating with **▶ Start**). Bad fixes, standing-still
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

The ♿ layer (Layers tab, also switched on automatically for ♿ routes) shows TU's accessibility survey: routes rated
accessible, limited or not accessible, stairs, accessible entrances, accessible parking and paratransit stops.

Step-free routing combines OpenStreetMap walkways with TU's survey (`src/lib/tu.js`):
- walkways running along a TU-rated segment take its rating; "not accessible" ones are never used;
- walkways next to a TU stairs point count as stairs, unless TU rates that stretch accessible;
- TU's accessible segments are added as **step-free-only** connectors where OpenStreetMap lacks them (e.g. the ramp to
  a building's accessible door). Regular routes never use them;
- step-free routes start and end at a building's **accessible entrance** (the closest of up to four).

With TU's data, every building except Scarborough Hall has a step-free route from every other building (TU lists no
accessible entrance there and rates the paths around it not accessible; the app says so and gives ADS's number).

Without TU's data the layer falls back to OpenStreetMap: step-free footpaths, stairs, raised curbs, rough surfaces, curb
cuts and accessible parking. Ramps, elevators or extra entrances can also be added with the
editor (`?edit=1` → Accessibility tools: click the map, add a note, then **Download accessibility.js** and replace
`src/data/accessibility.js`). Once a building has an accessible entrance listed, ♿ routes go to that door instead of the
building's center. This is best done with Accessibility & Disability Services and checked in person, using TU's
[official accessibility map](https://www.towson.edu/maps/documents/campus-map_accessibility.pdf) as a guide.

## Walk With Me — how it works

- The walker taps **🛡️ Walk With Me** on any route and shares a link (text, share sheet). The friend opens it and sees
  the planned route and expected arrival time.
- **Live location for the friend needs cloud accounts** (Supabase, see Accounts above): walker and friend exchange
  updates over Supabase Realtime. Without it the friend sees the plan, and the walker's own safety timer still works.
- 5 minutes past the expected arrival the walker's phone asks "Are you OK?". No answer within 60 seconds shows
  **Call TU Police (410-704-4444)**, **Call 911**, **Text a friend my location** and **SafeWalk escort (410-704-7233)**.
  With cloud accounts the friend's screen also turns red. Web apps can't place calls or send texts by themselves, so
  every emergency action is one tap by a person.
- Numbers come from towson.edu/public-safety/police. Re-check them each year.

## Hall Cup — privacy and fairness

- Students pick their team (residence hall or Commuters) in **My account → Hall Cup**; leaving it removes their entry.
- The only thing shared is the student's **weekly step total and team** (`weekly_steps` table). Row-level security means
  nobody can read anyone else's row; the leaderboard comes from `hall_leaderboard()`, which returns hall totals only.
- Halls need **3+ walkers** to be ranked, so no one's own count can be worked out; ranking is by **average steps per
  walker** so big halls don't win on size; weekly totals are capped at 250,000 steps.
- Database setup: `supabase/schema.sql` then `supabase/leaderboard.sql` (both already applied to the live project).

## Weather

Campus Pulse shows current conditions from [Open-Meteo](https://open-meteo.com) (free for non-commercial use, no key),
cached on each phone for 20 minutes.

## Project layout

```
src/
  data/buildings.js   buildings, categories, amenities, hours  ← edit me
  data/places.js      fallback parking + shuttles, closures, safety
  lib/graph.js        walking graph, A* routing, routing profiles, turn-by-turn
  lib/search.js       fuzzy search + room-number parsing
  lib/hours.js        open-now / weekly hours
  lib/schedule.js     class planner + .ics export
  data/accessibility.js  ramps, elevators, accessible entrances  ← edit me (or use ?edit=1)
  lib/osm.js          OpenStreetMap → routing graph (+ ramps, curbs, surfaces)
  lib/tu.js           TU's campus map data → routing graph, buildings, offices
  lib/activity.js     GPS distance filter, step detector, goals, streaks
  lib/reminders.js    when to remind for each class
  lib/challenges.js   weekly challenges, badges, building visits
  lib/leaderboard.js  Hall Cup teams and ranking
  lib/walkwithme.js   Walk With Me safety timer + friend view logic
  lib/weather.js      Open-Meteo weather + walking advice
  lib/sun.js          sunrise/sunset (best-lit routes after dark)
  lib/alternatives.js multiple route options
  lib/account.js      accounts: on-device or Supabase
  lib/demo.js         demo mode: sample student, in-memory only
  ui/editor.js        ?edit=1 data editor (pins + accessibility)
  ui/me.js            Me tab (account, goals, tracking, chart)
  ui/tracker.js       walk tracking (GPS + motion sensor + wake lock)
  ui/notify.js        class reminder notifications
  ui/pulse.js         Campus Pulse
  ui/walk.js          Walk With Me screens
  ui/tour.js          self-guided tour
  data/tour.js        tour stops and wording  ← edit me (have Admissions review)
  config.js           Supabase settings (optional)
supabase/schema.sql   cloud accounts table + security rules
supabase/delete-account.sql  lets a student delete their own login from the app (App Store requirement)
src/native.js         iPhone-app features (notifications, step counter, background location, haptics)
ios/                  the iPhone app project (Capacitor); resources/ holds its icon and splash sources
docs/APP_STORE.md     how to publish to the App Store
  main.js             app UI (Leaflet map, panels, URL state)
scripts/fetch-osm.mjs
scripts/fetch-tu.mjs  TU's official campus map layers → public/data/tu-campus.json
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
