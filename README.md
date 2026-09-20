# Career Tracker

Personal career + productivity assistant for tracking job applications, network contacts, resumes, and follow-ups — with a dashboard for progress over time.

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-6.0-092E20?logo=django&logoColor=white)
![Django REST Framework](https://img.shields.io/badge/DRF-API-ff1709?logo=django&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)
![Claude Code](https://shields.io)

## Core features

- **Application pipeline** — stages (applied → OA → interviews → offer) and outcomes, fully editable, with an append-only history of every change
- **Multi-role applications** — one application can cover several roles/listings at the same company
- **Applications views** — table, a responsive card grid, or a bubble view grouped by stage or region
- **Resume library** — resumes linked to applications (general / company / role-specific), each able to carry the actual PDF / Word / Pages file
- **Network & leads** — people tied to companies (with photos), contact channels, and a per-contact catch-up cadence (defaults to 3 months, overridable per person); the bubble view is the default and rings each person in their status colour
- **Bubble view** — the network as hub-and-spoke rings, one per company, with logos and faces
- **Catch-ups** — meeting minutes per catch-up, on their own page and on each contact's profile
- **Experience & galleries** — the companies you've worked for, each with a photo gallery
- **Job Directory** — shared reference data (companies, roles, listings, places), click-to-edit like any other record, plus an industry bubble view grouping companies and roles together
- **Company profiles** — every company has its own page: logo, industry and regions behind an Edit button, a panel of that company's job listings and applications, and a Known Connections panel of your own network contacts there
- **Job listings** — each has its own profile page (full description, skill tags, linked applications, Edit and Delete), a marker when any application to it came in via LinkedIn, and an AI-assisted **Import listing** — paste a real job ad into any AI with a copy-paste prompt and its JSON reply creates the listing
- **Region map** — applications by country on a pan/zoom map (wheel, trackpad or the +/− buttons), powered by optional region tags on a company; click through to the filtered list
- **Dashboard widgets** — every panel is a widget: progress chart, pipeline, needs-attention, outcomes, activity feed, quote, calendar, focus stats, pinned photo and region map, each movable, resizable (1–4 columns), hideable, and saved to your account
- **Onboarding tour** — an interactive, page-by-page walkthrough with a "try it" action on every page, skippable, and replayable any time from Settings
- **Quick access menu** — a floating shortcut menu, one click from anywhere to log an application, add a lead, log a coffee chat, add an event, a resume, or a listing
- **Notifications** — a bell in the sidebar with everything due or overdue in the next 7 days, unread counts, dismiss-one or clear-all, and a repeating iPhone-style chime on calendar reminders
- **Backup & restore** — export everything to Excel or JSON, and import either back; Settings also has a guarded "delete all my data" that empties the account without deleting it
- **Celebrations** — fireworks on real progress: a submission, a stage advance, a catch-up, a new contact, a finished todo, a new role
- **Todos / follow-ups** — tasks linked to applications, people or companies, plus suggested follow-ups
- **@mention autocomplete** — type `@` in a todo, a contact's notes, a catch-up's minutes, or a company's own notes, and it suggests your people and registered locations, narrowing as you type; arrow keys move the selection, Tab/Enter accepts it
- **Company notes** — private to you, not shared with anyone else tracking that company
- **Dashboard** — weekly/monthly progress, pipeline snapshot, outcome mix, and a combined activity feed
- **Auth** — token auth, profile pictures, all data scoped to the signed-in user
- **Themes** — light, dark, and **Intern mode**: the PwC palette over a blurred, swappable wallpaper. Theme, preset, font, celebrations and board layout all belong to the account: signing in adopts that user's own settings and resets anything they've never picked, so two people sharing a browser never inherit each other's look

## Themes

Three themes, picked in Settings → Appearance or cycled with the header button:

| Theme | What it is |
|-------|------------|
| Light | Flat surfaces, maximum contrast |
| Dark | Same layout on dark surfaces |
| Intern | PwC orange brand over a blurred wallpaper, with frosted-glass cards |

Intern mode ships four backgrounds (PwC lock screen, City towers, Orbit, Sage
arches) plus a flat no-image option, with two sliders:

- **Blur** — 0–48px backdrop blur
- **Image opacity** — 5–100%; how much of the photo survives the scrim

Each background carries a recommended pair of values, and selecting one snaps
the sliders back to them (there is a reset link too). Whatever you choose, the
scrim stays **top-weighted** — heaviest where the page header sits directly on
the image, lighter further down where glass cards cover it — so the heading
stays readable even at full image opacity. Picking a background from any theme
switches you into Intern mode, since that is the only theme it shows in.

The chart palettes are per-theme and each was validated rather than eyeballed:
Intern mode leads the categorical slots with PwC orange (`#d04a02`), and the
pipeline uses a single-hue PwC-orange ordinal ramp with monotone lightness whose
light end still clears 2:1 against the glass surface.

Source images live in `frontend/src/assets/`; the downscaled copies actually
shipped are in `frontend/src/assets/wallpapers/` (1920px wide, ~1.4 MB total
versus 5.4 MB for the originals — they get blurred anyway).

Theme, wallpaper, slider values, colour preset and font all persist to the
signed-in account (`Profile`), not only to `localStorage` — two different
accounts in the same browser no longer see each other's picks, and a pick
follows the account to a new device on next login. `localStorage` still gets
every change too, so the current device keeps working logged-out and there's
no flash-of-default on reload.

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Django 6, Django REST Framework |
| Auth | DRF Token auth (session auth kept for the browsable API) |
| DB | PostgreSQL 17 via Docker Compose (SQLite fallback) |
| Frontend | React 19, Vite, TypeScript, React Router 7 |
| Styling | Tailwind CSS v4 — light, dark and Intern (PwC) themes |
| Charts | Hand-rolled SVG (no chart dependency) |
| Maps | `d3-geo` + `topojson-client` (region map) — plain computation libraries, not a React map wrapper |

## Running it

### 1. Database

```bash
cd backend
docker compose up -d          # Postgres 17 on localhost:5433
docker compose ps
```

`backend/.env` drives the connection. Set `USE_POSTGRES=false` to fall back to the
local `db.sqlite3` file instead.

### 2. Backend

```bash
source .venv/bin/activate
pip install -r backend/requirements.txt

cd backend
python manage.py migrate
python manage.py seed_demo    # optional: demo account with realistic data
python manage.py runserver    # http://127.0.0.1:8000
```

`seed_demo` creates a `demo` / `demo-pass-1234` account with applications,
contacts and todos, and is safe to re-run (it refreshes that user's rows).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

`frontend/.env` points at the API via `VITE_API_URL`.

### Tests

```bash
cd backend && python manage.py test     # 237 API tests
cd frontend && npx tsc -b --noEmit && npx eslint .
```

## API

Everything the SPA uses lives under `/api/`. The DRF browsable API is available
in a browser, and the Django admin at `/admin/`.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/register/`, `login/`, `logout/`, `GET|PATCH /api/auth/me/`, `POST|DELETE /api/auth/me/avatar/` |
| Catalogs | `/api/companies/`, `roles/`, `industries/`, `countries/`, `states/`, `locations/` — each with `POST .../ensure/` for get-or-create by name; companies add `POST\|DELETE {id}/logo/` and a writable `regions` field (M2M to Country) |
| Resumes | `/api/resumes/` plus `POST\|DELETE {id}/file/` |
| Listings | `/api/job-listings/` |
| Applications | `/api/applications/` (supports `?region=`) plus `choices/`, `{id}/listings/`, `{id}/events/`, `{id}/advance/` |
| Network | `/api/people/` plus `choices/`, `{id}/log-meeting/`, `POST|DELETE {id}/photo/`; `/api/contact-methods/` |
| Todos | `/api/todos/` plus `choices/`, `{id}/toggle/`, `suggestions/` |
| Dashboard | `/api/dashboard/summary/`, `timeseries/`, `activity/`, `attention/`, `companies/`, `regions/` |
| Backup | `GET /api/backup/summary/`, `export.xlsx`, `export.json`; `POST /api/backup/import/` |

Lists are unpaginated by design — this is a single-user tracker and the SPA
filters client-side over the full set. Filtering, search and ordering are
supported as query params (e.g. `/api/applications/?stage=offer&ordering=-applied_at`).

## Application history

Applications are editable, and **every save is recorded** — not just pipeline
movement. `AppsEventLog` carries an `event_type` (`created` / `stage` /
`outcome` / `edited`) alongside a `changes` diff, so the application's timeline
shows what actually changed:

```
Moved to Offer  from Video interview
  Final round booked
  Source · Referral — Sarah Chen → Referral — final round
Edited
  Follow-up · 12 Sep 2026 → 15 Oct 2026
  Notes     · Applied through their 2026 intake. → Recruiter confirmed the AC date.
```

Design notes:

- **One row per save.** A stage move that also changed three fields is a single
  event carrying both the transition and the diff, not four rows.
- **A no-op save writes nothing** (FR-LOG-04) — re-submitting an untouched form
  must not litter the history.
- **Edits never count as pipeline movement.** `event_type` keeps them out of the
  dashboard's "stage advances" series, which still measures only real progress.
- Values in the diff are rendered for display (a resume shows its label, not its
  id), but **dates stay ISO in the API** and are formatted client-side — the
  viewer's locale isn't something the API should have an opinion about.
- Edits surface in the dashboard's **Recent activity** with their own icon and a
  summary like *"EY: updated follow-up, source and 1 more"*. If a stage move
  also carried edits, the row says so rather than hiding them behind the
  transition.

## Network bubble view

`/network?view=bubbles` draws the network as one **hub-and-spoke ring per
company**: the company logo at the centre, each contact tethered to it by a
line, with their photo and name always rendered (never hover-only).

It is deliberately a grid of small independent rings rather than one
force-directed graph — "who do I know at each company" is the question this
view answers, and separate rings answer it with no layout settling and no
overlapping nodes. Each ring is sized to its own contents, its radius follows
the arc its nodes need, labels sit on the outer edge of the ring, and
connectors are trimmed to the circle edges so nothing is drawn underneath
anything else. Past nine contacts a company folds the remainder into a `+N`
node.

A contact who works at several companies appears in **every** ring they belong
to, which is the truth of the M2M rather than an arbitrary pick. Contacts with
no company collect in a "No company" ring, always sorted last. Hovering a
bubble highlights its connector; clicking opens the contact.

The Job Directory's Companies tab has a matching **industry bubble view**: one
ring per industry, its companies as spokes, with the distinct roles seen
across that industry's job listings shown as a badge row underneath — derived
from each listing's company and role, since Role itself carries no industry
of its own.

## Region map

An opt-in dashboard widget plots applications by country. A company can
optionally be tagged with the regions it operates in (Job Directory → a
company → Regions) — deliberately separate from a job listing's precise
city/state/country, since a listing's location is frequently left blank and
the map needs something more reliable to read. Colour intensity follows
application count; hovering a country shows the count, clicking it filters
Applications down to that region.

The world outline itself is computed client-side from a public topojson
dataset via `d3-geo` and `topojson-client` rather than a React map wrapper —
the obvious choice, `react-simple-maps`, pulls in a CommonJS `prop-types`
dependency this project's Vite/Rolldown dev server can't bundle.

Applications has its own region filter too, and a **bubble view** (alongside
table and card views) that groups applications into rings by stage or by
region, the same hub-and-spoke pattern as the network and industry views.

## Onboarding tour

A first-login tour walks through every page — not a static slideshow, each
step actually navigates there, so the sidebar's real active-state highlight
follows along. Most steps carry a **"Try it"** button that opens that page's
own create-form (or, for Network, switches to bubble view) — the tour has no
special knowledge of any page's internals, it just triggers the same
`?new=1` query param handler each page already owns for this.

Skippable, and dismissing it (finishing, skipping, or "don't show this
again") is remembered on the account. It's also replayable any time from
Settings — a replay never marks it "seen" again, so it can't undo a genuine
first-time dismissal.

A first run also **seeds sample data** — one application, todo, coffee chat
(with its contact) and calendar event — so the tour walks through pages with
something on them rather than empty states. When the tour ends, by any exit,
a checklist asks which of those to keep; everything unticked is deleted. The
seeded rows are tracked in their own table rather than flagged across five
domain models, so cleanup never has to guess what was sample data.

A **quick access menu** (bottom-right, every page) offers the same six
create actions the tour highlights, one click away without hunting for the
right page first.

## Images

Profile pictures, contact photos and company logos are uploaded on dedicated
multipart endpoints (`/api/auth/me/avatar/`, `/api/people/{id}/photo/`,
`/api/companies/{id}/logo/`) rather than on the main JSON forms, so those forms
keep their nested payloads.

Every upload is validated (type, 5MB ceiling) and re-encoded server-side:

- **Avatars and photos** are cropped to a 512px square, EXIF rotation applied,
  the crop biased slightly above centre for faces — a 12MP phone photo lands as
  a ~40KB thumbnail.
- **Company logos** are *contained* in a 256px box instead, keeping their
  proportions and transparency, because cropping a wordmark to a square would
  cut the brand in half. Upload them per row in Job Directory → Companies (or
  from that same company's edit modal); they are shared reference data, like
  the company name itself.
- **Resume documents** are a different problem: a `.docx` or `.pages` file is a
  zip container and a `.pdf` is a byte stream, so they're validated by extension
  allow-list *plus* magic number, then stored and served back — never parsed or
  executed. See `backend/config/documents.py`.

Stored filenames carry a random suffix: without it a replacement reuses the same
URL and browsers keep serving the picture you just replaced.

Files live under `backend/media/` (git-ignored), served by Django in `DEBUG`.
Put a real file server or object store in front of `MEDIA_ROOT` in production.

The signed-in user's profile picture doubles as the app mark in the sidebar,
falling back to the logo until one is set.

## Backup & restore

Settings → Backup exports the whole account as a **workbook** (one sheet per
domain, readable in Excel) or a **JSON data file**. Both import back in — an
export that can't be imported is a report, not a backup, so the two formats
share one archive shape and the round trip is covered by tests.

Importing is **destructive by design**: this is disaster recovery, so it
replaces the account rather than merging. The API refuses to run without an
explicit `mode=replace`, and the UI always runs a dry run first and shows you
the row counts before anything is written. Shared catalog entries (companies,
roles, locations) are ensured, never deleted — they belong to every user.

Uploaded binaries aren't in the archive yet; their filenames are, so you know
what to re-attach.

## Project layout

```
backend/
  config/          settings, root URLs
  accounts/        register / login / logout / profile
  applications/    catalogs, resumes, listings, applications, event log
  network/         people + contact methods
  catchups/        meeting minutes, linked to people
  todos/           tasks linked to applications / people / companies
  dashboard/       read-only aggregation across the domains
  backup/          export / restore the whole account
frontend/src/
  api/             typed client + per-domain resources
  auth/            auth context and route guards
  components/      UI kit, charts, layout, domain forms
  pages/           one file per route
```

See [`documentation/functional-requirements.md`](documentation/functional-requirements.md)
for the original product vision, and
[`documentation/functional-requirements-extension.md`](documentation/functional-requirements-extension.md)
for everything built since — the extension is the source of truth for what
actually exists, and lists what's still outstanding.
