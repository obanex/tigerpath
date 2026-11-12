# Putting TigerPath on the App Store

The iPhone app is the same TigerPath code wrapped with [Capacitor](https://capacitorjs.com), plus native features the
website can't have:

| Feature | Website | iPhone app |
|---|---|---|
| Class reminders | Only while TigerPath is open | Real iOS notifications, a week ahead, even when the app is closed |
| Steps | Only while tracking a walk | From the iPhone's step counter, every day, filled in automatically (Hall Cup too) |
| Turn-by-turn directions | Stops when the screen locks | Keeps going with the phone locked; haptic tap at each turn |
| Offline | After a first visit | Map, paths and campus data built in |

Nothing about the website changes; both are built from `src/`.

## What only you can do (about an hour, plus Apple's review)

### 1. Join the Apple Developer Program — $99/year
<https://developer.apple.com/programs/enroll/>. Enroll as an **individual** with your own Apple ID (an organization needs a
D-U-N-S number). Approval usually takes 1–2 days.

### 2. Create the app in App Store Connect
<https://appstoreconnect.apple.com> → Apps → **+** → New App
- Platform: iOS · Name: **TigerPath: Campus Walks** (if "TigerPath" alone is taken; names are unique store-wide)
- Bundle ID: register **io.github.obanex.tigerpath** first at developer.apple.com → Identifiers (or pick it in the list)
- SKU: `tigerpath` · User access: Full access

### 3. Make an App Store Connect API key (lets GitHub sign and upload builds — no Mac needed)
App Store Connect → Users and Access → **Integrations** → App Store Connect API → Team Keys → **+**
- Name: `GitHub`, Access: **Admin** (needed so it can create the signing certificate for you)
- Download the `.p8` file (you can only download it once) and note the **Key ID** and **Issuer ID**.
- Your **Team ID** is at developer.apple.com → Account → Membership details.

### 4. Add four secrets to GitHub
<https://github.com/obanex/tigerpath/settings/secrets/actions> → New repository secret:

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID (10 characters) |
| `ASC_KEY_ID` | Key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | Open the .p8 file in a text editor and paste everything, including the BEGIN/END lines |

Then Actions → **iPhone app** → Run workflow. About 15 minutes later the build is in App Store Connect → TestFlight.
After that, every push to `main` uploads a new build.

### 5. Test it on your iPhone with TestFlight
Install **TestFlight** from the App Store. In App Store Connect → TestFlight → Internal Testing, add yourself; open the
invite on your phone. Walk somewhere on campus with directions, lock the phone, check the turn prompts still come, and
check a class reminder arrives with the app closed. You can invite up to 100 internal and 10,000 external testers (friends,
an orientation office) before the public release.

### 6. Fill in the App Store listing and submit
Use the text below, add screenshots (6.9" iPhone, at least 3: take them on your phone, or ask me to make them), set the
price to Free, and press **Add for Review**. Apple usually answers in 1–3 days.

## Before you submit — two things to check

**Use of Towson's name.** The app describes itself as "for Towson University" and says on the welcome screen, in My account,
in the privacy policy and on the support page that it is an independent student project, not an official app. The app icon
uses no TU logo. Apple can still ask whether you're allowed to use a university's name (guideline 5.2.1). The cleanest
answer is a short email from TU (University Marketing & Communications, or the office sponsoring your pilot) saying they
don't object; attach it in the review notes if you have one.

**Full account deletion.** Apple requires that "Delete account" deletes the login, not just the data. Run
`supabase/delete-account.sql` once in the Supabase dashboard → SQL Editor (it adds a function that lets a signed-in
student delete only their own account). Until then the app deletes the student's data but the login stays.

## Listing text

**Name:** TigerPath: Campus Walks
**Subtitle (30 max):** Towson walking guide & reminders
**Category:** Navigation · secondary: Education
**Age rating:** 4+ (no objectionable content; answer "None" throughout)
**Price:** Free · no in-app purchases

**Promotional text (170 max):**
New at Towson? Find any building, office or room, get step-free walking directions, and never be late for class.

**Description:**
TigerPath is a walking guide to the Towson University campus, made by a Towson student.

FIND ANYTHING
Search buildings, offices and rooms. Type "LA 4310", "registrar" or "financial aid" and TigerPath shows you where to go.

WALKING DIRECTIONS, TURN BY TURN
Pick the fastest way, another way, a step-free route or the best-lit route after dark. Tap Start and TigerPath follows you
along campus paths, tells you when to turn, and keeps going with your phone locked.

STEP-FREE ROUTES
Built on Towson's own accessibility survey: accessible entrances, rated paths and stairs to avoid. Step-free directions take
you to a building's accessible door.

NEVER LATE FOR CLASS
Add your schedule once. TigerPath tells you how long each walk takes, warns you about tight transitions, and reminds you when
it's time to leave — even when the app is closed.

WALK WITH ME
Share your walk home with a friend. If you're running late, TigerPath checks you're OK and puts TU Police, 911 and your friend
one tap away.

STEPS, CHALLENGES AND THE HALL CUP
Your iPhone's step count fills in automatically. Hit daily goals, earn badges, and walk for your residence hall in the weekly
Hall Cup.

VISITING?
Take the self-guided campus tour: ten stops with directions between them and a story at each one.

Private by design: no ads, no tracking, and we never store the routes you walk.

TigerPath is an independent student project and is not an official Towson University app.

**Keywords (100 max):** towson,campus,map,TU,tigers,walking,directions,accessible,class,schedule,steps,tour,college,university

**Support URL:** https://obanex.github.io/tigerpath/support.html
**Marketing URL:** https://obanex.github.io/tigerpath/
**Privacy Policy URL:** https://obanex.github.io/tigerpath/privacy.html

## App Privacy answers ("nutrition label")
App Store Connect → App Privacy → Get Started. Data **is** collected. For each item: **linked to the user**, **not used for
tracking**, purpose **App Functionality**.

| Category | Type | Collected? |
|---|---|---|
| Contact Info | Name, Email Address | Yes |
| Health & Fitness | Fitness (daily step and distance totals) | Yes |
| Location | Coarse Location | Yes — the campus buildings a signed-in student has visited (for badges), saved as building names and dates |
| Location | Precise Location | **No** — GPS is used on the device and relayed live to friends during Walk With Me, but never stored |
| User Content | Other User Content (class schedule, favorites, goals) | Yes |
| Identifiers | User ID | Yes |
| Usage Data, Diagnostics, Purchases, Browsing, Search, Contacts, Financial, Sensitive Info | — | No |

## Notes for the reviewer (App Review Information → Notes)
> TigerPath is a walking guide for Towson University's campus in Towson, Maryland. Because directions only work on campus,
> please tap **"Just looking? Try a demo with a sample student"** on the first screen: it opens the app as a sample student
> with a class schedule, step history, badges and a Hall Cup. In demo mode, choose Directions (e.g. from "Albert S. Cook
> Library" to "Liberal Arts Building") and tap **▶ Start** to watch turn-by-turn navigation walk the route on screen.
> Nothing in demo mode is saved.
>
> Background location is used only while the user is navigating a route or sharing a Walk With Me walk they started, so turn
> prompts and the friend's live view keep working with the phone locked. It stops when the walk ends.
>
> Accounts are optional (guest mode works). Sign-in demo account: **[email]** / **[password]** (create one in the app first).
> Account deletion: My account → Account & data → Delete account.

## Updating the app later
Push to `main` → a new TestFlight build uploads automatically → in App Store Connect create a new version (e.g. 1.1), pick
the build, submit. Change the version number in Xcode's project settings (`MARKETING_VERSION` in
`ios/App/App.xcodeproj/project.pbxproj`).

## Working on the iPhone project yourself (needs a Mac)
```bash
npm ci && npm run build && npx cap sync ios
npx cap open ios        # opens Xcode; pick your team under Signing & Capabilities, then Run
```
After changing anything in `src/`, run `npm run build && npx cap sync ios` again.
