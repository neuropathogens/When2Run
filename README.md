# 🏃 when2run

**when2meet, but for runners.** Line up a time for a group run with a drag-to-paint
availability heatmap — then take it the rest of the way runners actually need:
agree on a **place**, a **pace**, and a **route** (with Strava), check the
**weather** for the chosen slot, and lock it in.

No accounts. No app install. Create a run, share one link.

<p align="center"><em>Find the time to run together.</em></p>

---

## Why it's nicer than when2meet

when2meet nails one thing — overlapping availability — and stops there. Runners
still have to argue about *where*, *how fast*, and *which route* in a group chat.
when2run keeps the thing that works and folds in the rest:

| | when2meet | **when2run** |
|---|:---:|:---:|
| Drag-to-paint availability grid | ✅ | ✅ |
| Live group heatmap + "who's free" | ✅ | ✅ |
| Modern, responsive UI + dark mode | — | ✅ |
| Meetup-spot suggestions + voting + map | — | ✅ |
| Group **pace** calculator & converter | — | ✅ |
| **Route** suggestions + **Strava** embeds/import | — | ✅ |
| Run-time **weather** forecast | — | ✅ |
| RSVP (in / maybe / out) | — | ✅ |
| One-click **"lock the time"** + `.ics` export | — | ✅ |
| Built-in run **chat** | — | ✅ |

## Features

- **📅 Availability heatmap** — click-and-drag to paint the times you can run
  (mouse *and* touch). Your grid sits next to a live group heatmap; hover any
  cell to see exactly who's free. The best slot is auto-highlighted.
- **📍 Locations** — suggest meetup spots, search real addresses (OpenStreetMap
  geocoding), see them all pinned on a map, and upvote. Leading spot floats up.
- **🏃 Pace lab** — everyone sets a goal pace; you get fastest / median and a
  *"no runner left behind"* group pace, a distribution chart, predicted finish
  times (5K → marathon), and a min-km ⇄ min-mile ⇄ km/h converter.
- **🗺️ Routes + Strava** — paste any Strava **route / activity / segment** link
  and it renders as an interactive embedded map. Connect Strava to import your
  own saved routes. Add distance, elevation, and surface. Vote on the winner.
- **🌦️ Weather** — the best (or locked) time slot pulls an hourly forecast for
  the top-voted location — temp, feels-like, rain %, wind. (Open-Meteo, no key.)
- **✅ RSVP + finalize** — mark yourself in / maybe / out. The organizer can lock
  a slot (or click any heatmap cell to lock it) and everyone can export `.ics`.
- **💬 Chat** — a lightweight message thread per run.
- **🔗 Zero friction** — no sign-up. Identity is a name (optionally PIN-protected)
  stored in the run's link. Live updates via polling. Light/dark theme.

## Tech

- **Backend:** Node + Express + SQLite (`better-sqlite3`). A small REST API,
  server-side proxies for geocoding / weather / Strava, and an env-gated Strava
  OAuth flow. No ORM, no build step.
- **Frontend:** dependency-free ES-module vanilla JS + a hand-rolled CSS design
  system. Leaflet for maps, Strava's official embed for routes — both from CDN.
- **Storage:** a single SQLite file in `data/`. Each run is fully self-contained.

## Run it locally

```bash
npm install
npm start
# → http://localhost:3000
```

Then open the link, create a run, and share the URL.

```bash
npm test        # end-to-end API smoke test (no framework, no network needed)
```

There's also an optional headless-browser walkthrough at `test/browser.check.js`
(needs `puppeteer-core` + a local Chrome) that clicks through the whole flow and
fails on any console error.

## Configuration

Everything works with **zero config**. Copy `.env.example` → `.env` to tune:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default `3000`). |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Optional. Enables one-click **"Connect Strava"** + import-my-routes. Without them, pasting a Strava link still embeds an interactive map. Create an app at <https://www.strava.com/settings/api>. |

## How it fits together

```
server.js        Express app: REST API + Strava OAuth + geocode/weather proxies
db.js            SQLite schema + id/token/color helpers
public/
  index.html     SPA shell (Leaflet + fonts)
  css/styles.css themable design system
  js/
    app.js       router, event creation, scheduler view, live polling, .ics
    grid.js      drag-to-paint availability grid + group heatmap
    panels.js    pace lab · locations+map · routes+Strava · comments · weather
    api.js       fetch client + per-run identity (localStorage)
    util.js      DOM, time/slot math, pace conversions, formatting
```

### API sketch

```
POST   /api/events                                   create a run
GET    /api/events/:id                               full snapshot (public)
GET    /api/events/:id/version                        cheap polling probe
PATCH  /api/events/:id                                admin: title / finalize slot
POST   /api/events/:id/participants                   join / sign back in
PUT    /api/events/:id/participants/:pid/availability paint availability
PUT    /api/events/:id/participants/:pid/prefs        pace / distance / rsvp
POST   /api/events/:id/locations        · /:lid/vote  suggest + vote spots
POST   /api/events/:id/routes           · /:rid/vote  suggest + vote routes
POST   /api/events/:id/comments                       chat
GET    /api/geocode?q= · /api/weather?lat=&lng=&date= no-key proxies
GET    /auth/strava · /api/strava/routes              OAuth + route import
```

### Data & privacy

- No emails, no passwords. A participant is just a name; an optional PIN protects
  editing your own entry. Tokens live in your browser's `localStorage`.
- The organizer's admin token is only ever stored in the creating browser.
- Strava access tokens are never persisted server-side — they're handed to the
  SPA and used per-request.

## Deploy

Any host that runs Node works (Render, Railway, Fly, a VPS…). Persist the `data/`
directory for SQLite. Set `STRAVA_*` if you want native Strava import, and point
your Strava app's callback domain at your deploy URL.

## License

MIT — see [LICENSE](LICENSE).
