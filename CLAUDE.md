# TU TigerPath: notes for Claude

A campus walking guide for Towson University: a Vite + Leaflet web app (live at https://obanex.github.io/tigerpath/)
and the same code as an iPhone app (Capacitor, `ios/`). The README covers features and data sources;
`docs/APP_STORE.md` covers publishing. Read both before larger changes.

## Rules from the owner
- **Commits are authored as the owner** (`obanex <69535465+obanex@users.noreply.github.com>`) and must have **no
  Claude attribution**: no `Co-Authored-By: Claude`, no "Generated with Claude Code" lines, in commits or PRs.
- Never put the owner's personal email address in code, commits or requests to outside services.
- The app name is **TU TigerPath**. User-facing text may say "Towson University". Don't add an "unofficial" disclaimer
  (a TU partnership is planned).
- Push only when asked or when the task clearly includes deploying; `main` deploys to GitHub Pages automatically.

## Commands
```bash
npm ci
npm run dev                      # local dev server
npm test                         # unit tests (node:test), must pass
npm run build                    # → dist/
npx vite preview --port 4173 --host 127.0.0.1 &
E2E_URL=http://127.0.0.1:4173/ E2E_CLOUD=0 npm run test:e2e   # full browser test (58 checks); drop E2E_CLOUD=0 to include real Supabase accounts
E2E_URL=http://127.0.0.1:4173/ npm run test:a11y              # WCAG 2.2 AA scan + keyboard trip, must be 0 issues
node scripts/app-store-screenshots.mjs                        # App Store screenshots (preview server running)
```
Run unit, e2e and a11y tests after any UI or routing change. The e2e suite creates `tigerpath-e2e-…@example.com`
accounts when cloud tests run. Accounts delete themselves at the end; check for leftovers in Supabase.

## iPhone app (this Mac has Xcode)
```bash
npm run build && npx cap sync ios          # after every change in src/ or public/
npx cap open ios                           # or build from the command line:
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS,id=<device id>' -allowProvisioningUpdates DEVELOPMENT_TEAM=<team id> -derivedDataPath build
xcrun devicectl device install app --device <device id> build/Build/Products/Debug-iphoneos/App.app
```
- The owner uses a **free Personal Team** for now (no paid Apple Developer Program), so installs expire after 7 days and
  TestFlight isn't available. If the bundle ID `io.github.obanex.tigerpath` is refused for the free team, build with
  `PRODUCT_BUNDLE_IDENTIFIER=io.github.obanex.tigerpath.dev` and don't commit that.
- Native features live in `src/native.js` (no-ops on the web): class reminders as iOS local notifications, steps from
  Core Motion (`@capgo/capacitor-pedometer`), background location during navigation
  (`@capacitor-community/background-geolocation`), keep-awake, haptics. **None has been verified on a real iPhone yet**;
  the GitHub workflow only proves it compiles. Test them on the device first.
- `.github/workflows/ios.yml` compiles for the simulator on every push and uploads to TestFlight once App Store Connect
  secrets exist.

## Layout (main pieces)
- `src/main.js`: app UI, map, routing glue, navigation (`startNav`/`onLiveUpdate`), boot sequence
- `src/lib/`: pure logic with unit tests:
  - `graph.js`: A* and profiles
  - `nav.js`: turn-by-turn
  - `tu.js`: TU campus map data → graph/buildings
  - `osm.js`: OpenStreetMap data
  - `demo.js`: `?demo` sample student
  - `account.js`: local or Supabase accounts
  - plus `challenges`, `leaderboard`, `reminders`, `activity`
- `src/ui/`: screens:
  - `me.js`: account and Activity
  - `walk.js`: Walk With Me
  - `tour.js`: self-guided tour
  - `tracker.js`: walk tracking
  - `notify.js`: class reminders
  - `pulse.js`: Campus Pulse
- Data:
  - `public/data/osm-campus.json` (OpenStreetMap, monthly workflow)
  - `public/data/tu-campus.json` (TU's public ArcGIS layers via `npm run fetch-tu`, monthly workflow)
  - `src/data/*.js` (hand-kept buildings, places, tour text)
- `public/tiles/`: self-hosted map tiles (monthly workflow); `public/privacy.html`, `public/support.html`

## Backend
Supabase project `ymjivrxkoeskbcnxdzle`. The anon key is in `src/config.js` (public by design).
- SQL lives in `supabase/`:
  - `schema.sql`: user_data plus row-level security
  - `leaderboard.sql`: Hall Cup
  - `delete-account.sql`: `delete_my_account()`
- All three are applied to the live project. Schema changes need the owner's Supabase dashboard (SQL Editor) or their
  access token; ask before changing the live database.
- Demo mode (`?demo`) never calls Supabase.

## Gotchas
- Leaflet `flyTo` is wrapped (NaN guard plus reduced motion); use `fitView()`/`flyTo()` helpers in main.js.
- Buildings link only to OpenStreetMap walkway nodes (`isTuNode` excluded). TU's surveyed paths are added after the
  main component is measured.
- Step-free routes end at a building's accessible entrance (`doorsFor`); every route type may use TU's surveyed paths.
- Shared links must use `shareBase()` (public URL inside the app, not `capacitor://`).
