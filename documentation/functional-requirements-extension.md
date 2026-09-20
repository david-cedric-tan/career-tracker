# Functional Requirements — Extension

> **Status:** Living document
> **Purpose:** Record everything built since the original
> [`functional-requirements.md`](functional-requirements.md) draft, plus the
> features requested but not yet finished, so nothing is lost between sessions.
> **Relationship to the original:** the original defines the product vision.
> This file supersedes it wherever the two disagree, and is the source of truth
> for what actually exists.

---

## Legend

| Mark | Meaning |
| ---- | ------- |
| [Done] | Built and covered by tests |
| [Partial] | Built, partially — gaps listed inline |
| [Planned] | Specified here, not yet built |

---

## 1. Delivered since the original draft

### 1.1 Platform [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-PLAT-01 | REST API under `/api/`, token auth, all domain data scoped to `request.user`. | [Done] |
| FR-PLAT-02 | PostgreSQL 17 via Docker Compose, with a SQLite fallback behind `USE_POSTGRES`. | [Done] |
| FR-PLAT-03 | React 19 + Vite + TypeScript SPA, Tailwind v4, responsive from 390px up. | [Done] |
| FR-PLAT-04 | `seed_demo` management command produces a realistic, idempotent demo account. | [Done] |
| FR-PLAT-05 | Lists are unpaginated by design; filtering, search and ordering are query params. | [Done] |

### 1.2 Applications [Done]

Everything in original §5.4 and §5.5, plus:

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-APP-12 | Applications are **fully editable** after creation. | [Done] |
| FR-LOG-06 | The event log covers **every save**, not only stage/outcome moves. `event_type` ∈ `created` / `stage` / `outcome` / `edited`. | [Done] |
| FR-LOG-07 | Each row carries a `changes` diff: `[{field, label, from, to}]`, values rendered for display (a resume shows its label, not its id). | [Done] |
| FR-LOG-08 | One row per save. A stage move that also edits fields is a single event carrying both. | [Done] |
| FR-LOG-09 | A no-op save writes nothing. | [Done] |
| FR-LOG-10 | Edits never count as pipeline movement in the dashboard's stage-advance series. | [Done] |
| FR-LOG-11 | Dates stay ISO in the API and are formatted client-side — locale is a client concern. | [Done] |
| FR-REF-08 | Catalogs expose `POST .../ensure/` (get-or-create by name) so logging never requires pre-seeding. | [Done] |

### 1.3 Images [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-IMG-01 | Uploads use dedicated multipart endpoints, so JSON forms keep nested payloads. | [Done] |
| FR-IMG-02 | Every upload is validated: type allow-list, 5MB ceiling, real-image probe. | [Done] |
| FR-IMG-03 | Avatars and contact photos are cropped to a 512px square; EXIF rotation applied; crop biased above centre for faces. | [Done] |
| FR-IMG-04 | Company logos are **contained** in a 256px box, keeping proportions and transparency — cropping a wordmark would cut the brand in half. | [Done] |
| FR-IMG-05 | Stored filenames carry a random suffix, so a replacement can't be served from browser cache. | [Done] |
| FR-IMG-06 | Replacing an image deletes the superseded file rather than orphaning it. | [Done] |
| FR-IMG-07 | The user's profile picture doubles as the app mark in the sidebar. | [Done] |
| FR-IMG-08 | Company logos are shared reference data, editable from Job Directory → Companies. | [Done] |

### 1.4 Appearance [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-UI-01 | Three themes: Light, Dark, **Intern** (PwC palette over a wallpaper). | [Done] |
| FR-UI-02 | Five backgrounds for Intern mode, with frosted-glass surfaces above them. | [Done] |
| FR-UI-03 | Backdrop **blur** and **image-opacity** sliders, per-wallpaper presets, reset link. | [Done] |
| FR-UI-04 | Scrim stays top-weighted at any slider value, so the page heading stays legible. | [Done] |
| FR-UI-05 | Theme + wallpaper + slider state persist per browser and apply before first paint. | [Done] |
| FR-UI-06 | Chart palettes are per-theme and **validated**, not eyeballed (CVD separation, contrast, ordinal ramp monotonicity). | [Done] |
| FR-UI-07 | Dashboard greeting reads `hi, <username>`. | [Done] |

### 1.5 Network bubble view [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-NET-14 | `/network?view=bubbles` renders hub-and-spoke rings, one per company. | [Done] |
| FR-NET-15 | Hub shows the company logo; spokes show each contact's photo and name, always rendered (never hover-only). | [Done] |
| FR-NET-16 | A contact at several companies appears in **every** ring they belong to. | [Done] |
| FR-NET-17 | Contacts with no company collect in a "No company" ring, sorted last. | [Done] |
| FR-NET-18 | Rings size to their own contents; labels sit on the outer edge; connectors are trimmed to circle edges. | [Done] |
| FR-NET-19 | Past nine contacts, the remainder folds into a `+N` node. | [Done] |
| FR-NET-20 | Hover highlights a connector; clicking opens the contact. | [Done] |

---

### 1.6 Catch-ups & meeting minutes [Done]

See §2.1 for the requirement IDs — all delivered.

### 1.7 Navigation state [Done]

See §2.2 — delivered.

### 1.8 Work experience & galleries [Done]

See §2.3 — delivered.

### 1.9 Dashboard widgets & company panel [Done]

See §2.4 and §2.5 — delivered.

### 1.10 Resume attachments [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-RES-08 | A resume can carry the **actual document**: PDF, Word (`.doc`/`.docx`), Pages, ODT, RTF or plain text, up to 10MB. | [Done] |
| FR-RES-09 | Uploads are checked by extension **and** magic number, so a renamed executable can't pose as a PDF. | [Done] |
| FR-RES-10 | The original filename is kept for display and download; the stored name is suffixed so a replacement can't be served from cache. | [Done] |
| FR-RES-11 | Replacing or removing an attachment deletes the superseded file. | [Done] |
| FR-RES-12 | The library lists the attachment with its type and size, and links to open it. | [Done] |

### 1.11 Fixes and polish [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-TODO-07 | The todo status filter can reach **any** status. Previously "Any status" cleared the URL param and the `open` default immediately reasserted itself, so the filter was stuck. `all` is now an explicit, shareable value. | [Done] |
| FR-TODO-08 | A **completion meter** shows done vs total across all todos — counted over everything, not the current filter, so it can't read 100% just because you filtered to "Done". | [Done] |
| FR-UI-08 | The catch-ups icon is a coffee cup. | [Done] |
| FR-UI-09 | The sidebar mark and wordmark are **separate links**: the avatar opens your profile, the wordmark goes to the dashboard. | [Done] |

### 1.12 Profile & identity [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-PROF-01 | **Profile** (identity, career story) is split from **Settings** (app preferences). Experience lives on Profile, not Settings. | [Done] |
| FR-PROF-02 | Dashboard greeting reads "Hi, First Last" (falls back to username if no name is set). | [Done] |
| FR-PROF-03 | First name, last name and login email are required at registration, as before. | [Done] |
| FR-PROF-04/05/06 | Mobile number and LinkedIn URL are **required** at registration; school/work email is optional and kept separate from the login email. | [Done] |
| FR-PROF-07 | User-managed **important links** (label + URL) on the profile, unlimited, optional — registration itself asks for none of them. | [Done] |
| FR-PROF-08 | User-managed **addresses** (label + free text) on the profile — deliberately unstructured rather than street/city/postcode fields. | [Done] |
| FR-PROF-09 | The profile picture upload doubles as the sidebar app mark (carried over from FR-IMG-07). | [Done] |

### 1.13 Career story: Education, Certifications, Extracurriculars [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-PROF-10 | **Education** entries (school/programme, dates, description), each with attachments. | [Done] |
| FR-PROF-11 | **Extracurricular** entries (club/society/volunteering, dates, description), each with attachments. | [Done] |
| FR-PROF-12 | **Certification** entries (credential, dates, description), each with attachments. | [Done] |
| FR-PROF-13 | All three share one **attachment pattern** (generic relation): an image or a document (PDF/Word/etc.), classified and validated the same way regardless of which section it's attached to. | [Done] |

### 1.14 Application rejection & reapply [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-APP-REJ-01 | An application carries free-text **notes**, usable for "why rejected" / interview feedback / anything else worth remembering. | [Done] |
| FR-APP-REJ-02 | A **reapply reminder date**, independent of outcome — set it on a rejection to be reminded next intake, but nothing stops setting it on any application. | [Done] |
| FR-APP-REJ-03 | A reapply date due within the next 7 days surfaces on the dashboard's **attention** list, the same way an overdue follow-up does. | [Done] |

### 1.15 Calendar [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-CAL-01 | A dedicated **Calendar** page, in the nav, aggregating every date-bearing domain — todo due dates, application follow-ups and reapply reminders, catch-up follow-ups, and network "next chat" dates. | [Done] |
| FR-CAL-02 | Calendar is **read-only aggregation** — it owns no data of its own and can't drift from the domains it draws from. | [Done] |
| FR-CAL-03 | A **month grid**, with a side panel listing the selected day's events and a link straight through to each one. | [Done] |
| FR-CAL-04 | A **year grid** — twelve compact months at a glance, a dot on any day with something due; clicking a day jumps into month view on that date. | [Done] |
| FR-CAL-05 | Per-domain filter chips (task / follow-up / reapply / catch-up due / meeting follow-up), all on by default. | [Done] |
| FR-CAL-06 | **Export to `.ics`** — month view exports that month, year view exports the whole year, both from the same aggregation the page itself renders (one source of truth, no drift between what you see and what you download). | [Done] |

### 1.16 Appearance v2: presets, fonts, custom wallpaper, dynamic theme [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-UI-10 | A user can upload their **own photo** as an Intern-mode background, alongside the four built-in wallpapers. | [Done] |
| FR-UI-11 | A **background is independent of theme** — picking a wallpaper no longer force-switches to Intern mode, and the wallpaper shows (in the page's own background, not over the cards) under Light, Dark or any preset too. | [Done] |
| FR-UI-12 | A gallery of **named colour-scheme presets** (Dracula, Nord, Gruvbox ×2, Solarized ×2, Monokai, One Dark, Tokyo Night, Catppuccin Mocha, Rosé Pine Dawn, Everforest, Rouge), layered over the base theme as CSS custom-property overrides. | [Done] |
| FR-UI-13 | A handful of the presets are **company-branded** (PwC, Deloitte, EY, Canva) — colours drawn from each firm's public brand palette, personal-styling inspiration rather than a reproduction of their product UI. | [Done] |
| FR-UI-14 | Picking a firm-branded preset also switches to a **matching font** in one action (e.g. PwC → Work Sans, Canva → Poppins) — the closest widely-available stand-in for each firm's usually-unlicensed corporate typeface, not a claim to the literal font. | [Done] |
| FR-UI-15 | A **font picker** — system fonts plus a curated set of Google sans/serif/mono faces, each button rendered in its own face so you can see it before picking it. | [Done] |
| FR-UI-16 | A fourth theme mode, **Dynamic** — resolves to Light by day and Dark by night from the sun's actual position at the browser's location (geolocation, cached; a fixed 07:00–19:00 window if location is unavailable or denied). | [Done] |
| FR-UI-17 | In Dynamic mode, the header's theme toggle becomes a **live sun/moon indicator** instead of a manual cycle button; clicking it still works, as an override that exits Dynamic mode. | [Done] |
| FR-UI-18 | Page titles read "My Applications" / "My Network" / "My Catch-ups" / "My Todos" / "My Resumes" — the page heading only, not the nav labels. Job Directory is the deliberate exception: it's shared reference data, not "yours" the way the rest are, so its heading is plain "Job Directory". | [Done] |
| FR-UI-19 | The Celebrations toggle's knob stays within its track in both states — previously it overshot the track's right edge. | [Done] |

### 1.17 Full backup: Data + Resources [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-EXPORT-05 | A **`.zip`** backup bundles `data.json` (the same shape as the plain JSON export) with every file it references — resumes, library documents, profile avatar/wallpaper/pinned photo, experience photos, company logos, person photos, the icon and attachments of every education/certification/extra-curricular entry, profile-link icons and refinement message images — plus a `manifest.json` cross-referencing each file to the row that owns it. | [Done] |
| FR-EXPORT-10 | Importing a `.zip` reattaches every manifest file to the row the JSON restore just recreated, matched by **natural key** (resume label, person's full name, company name, experience's company+title+start-date) rather than a primary key, since restore always assigns fresh ids. | [Done] |
| FR-EXPORT-11 | The Backup panel offers **all three formats** side by side — "Full Data + Resources (.zip)" alongside the existing data-only Excel/JSON — so the choice of what a backup includes is explicit, not buried in a file extension. | [Done] |

### 1.18 Login experience [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-AUTH-04 | The login/register split-screen carries career-focused copy ("Your career isn't luck. It's a pipeline — and you're finally running it.") instead of generic SaaS copy. | [Done] |
| FR-AUTH-05 | A small 3D flourish — a fanned stack of "pipeline stage" cards with CSS perspective, tilting toward the pointer only while it's over the stack (not on every mouse move on the page). Static under `prefers-reduced-motion`. | [Done] |
| FR-AUTH-06 | A successful sign-in plays a brief checkmark transition before the redirect, instead of cutting straight to the dashboard. | [Done] |
| FR-AUTH-07 | A first-login **interactive tour** covering every page, dismissible for good (`Profile.onboarding_completed`) — see §1.19 for the full shape. | [Done] |

### 1.19 Interactive onboarding tour [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-ONBOARD-01 | The tour is a small floating card (not a full-screen modal), one step per page — it actually navigates there, so the sidebar's real active-state highlighting follows automatically. | [Done] |
| FR-ONBOARD-02 | Runs automatically on first login (`onboarding_completed = false`); Skip, "Don't show this again", the close button, and finishing the last step all mark it complete. | [Done] |
| FR-ONBOARD-03 | Replayable any time from Settings, freehand — a replay never touches `onboarding_completed`, so it can't undo a real dismissal. | [Done] |
| FR-ONBOARD-04 | Steps for Applications, Network, Catch-ups, Todos, Calendar, Resumes, Job Directory and Settings each carry an optional **"Try it"** action that opens that page's own create-form (or, for Network, toggles bubble/card view) via a `?new=1` query param the page already owns — the tour has no special-case knowledge of any page's internals. | [Done] |
| FR-ONBOARD-05 | Keyboard navigable (arrow keys, Escape to close); Escape closes only the tour, never a "Try it" modal that's open on top of it. | [Done] |
| FR-ONBOARD-06 | Per-step decorative icon animation themed to that page's domain (sonar ping for Network, rising steam for Catch-ups), disabled under `prefers-reduced-motion`. | [Done] |
| FR-ONBOARD-07 | The card has an animated conic-gradient glow (ring at the edge, a softer blurred halo beyond it), disabled under `prefers-reduced-motion`. | [Done] |
| FR-ONBOARD-08 | Last step's primary button reads "Let's start tracking", not a generic "Finish". | [Done] |
| FR-ONBOARD-09 | Opening the automatic (first-run) tour **seeds sample data** — one application, todo, coffee chat (with its contact) and calendar event — so each step lands on a populated page instead of an empty state. Idempotent: a second call is a no-op, and a manual replay never seeds. | [Done] |
| FR-ONBOARD-10 | Seeded rows are tracked in a dedicated `SampleDataRecord` table (generic FK) rather than an `is_sample` flag spread across five domain models, so cleanup never has to guess what was sample data. | [Done] |
| FR-ONBOARD-11 | Every exit from an automatic tour — finish, skip, "don't show this again", Escape, the close button — first shows a **keep-or-discard checklist** of the seeded categories, with counts and example titles. Everything starts unticked: sample rows are scaffolding, so a clean slate is the default and keeping one is the deliberate choice. | [Done] |
| FR-ONBOARD-13 | Confirming the keep-or-discard checklist **hard-reloads to the dashboard** (`window.location.assign('/')`) rather than just closing the modal — the notifications bell and the dashboard's own widgets fetched their data when the tour first opened, before cleanup ran, and never refetch on their own, so a discarded sample todo/event stayed visible in the notifications panel even though the row behind it was really gone. Same reasoning as Settings' "delete all my data". | [Done] |
| FR-ONBOARD-14 | That reload only fires **after** `onboarding_completed` is confirmed set — awaiting the same `finish()` the tour's other exit paths use, not a fire-and-forget call. Reloading first would race the profile PATCH: land back with the flag still false, and the auto tour re-triggers (re-seeding sample data) on the page that was supposed to be clean. | [Done] |
| FR-ONBOARD-15 | Two concurrent seed calls for the same brand-new account — React StrictMode's double effect-fire in dev, or a genuine double-click — can both pass the "nothing seeded yet" idempotency check before either commits. The loser hits a unique-constraint `IntegrityError` on the shared sample company; the seed endpoint swallows that (the other request already won the race) rather than surfacing a 500. | [Done] |
| FR-ONBOARD-12 | The sample catch-up and its contact are tracked under one category, since the catch-up's FK to the person is non-nullable — a keep/discard choice can never leave one without the other. Discarding everything also removes the sample company, but only once no application still references it. | [Done] |

### 1.20 Quick access menu [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-QUICK-01 | A floating button, bottom-right on every page, opens a vertical stack of shortcuts rather than a radial fan — a corner anchor has nowhere for a fan to sweep without going off-screen, and the stack echoes the brand mark's climbing-the-ladder figure (§1.23's sibling, FR-UI-09). | [Done] |
| FR-QUICK-02 | Six shortcuts — log an application, add a lead, log a coffee chat, add a calendar event, add a resume, add a job listing — each just deep-links to the owning page's existing `?new=1` handler (the same one the onboarding tour's "Try it" buttons use). | [Done] |
| FR-QUICK-03 | Closes on an outside click, on Escape, or after a shortcut navigates; hidden entirely while the onboarding tour is open, since both are bottom-right floating UI. | [Done] |
| FR-QUICK-04 | The main button glows (same conic-gradient treatment as the tour card) only while hovered or open, reverting to a plain state otherwise. | [Done] |

### 1.21 Dashboard: clock, weather & region map [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-DASH-12 | The dashboard header shows a live clock and current weather (via the browser's geolocation, reusing the same cached coordinates as the Dynamic theme's sunrise/sunset lookup — one geolocation prompt for the whole app). Not shown on other pages. | [Done] |
| FR-DASH-13 | The weather segment shows a city-level location (abbreviated to a common metro code — SYD, MNL, HKG — where one is known, else the plain city name) and links out to a weather search for that location. | [Done] |
| FR-DASH-14 | A **region map** widget (opt-in, off by default) shows applications by country as a choropleth — colour intensity by count, hover for the count, click through to Applications filtered to that region. | [Done] |
| FR-DASH-15 | The map reads `Company.regions` (§1.22), not job-listing locations — a listing's location is frequently left blank, so the company-level tag is the reliable source. | [Done] |
| FR-DASH-16 | New widgets that aren't in the default set (like the region map) still surface in the board's "Hidden" tray so they're discoverable, rather than requiring the user to already know they exist. | [Done] |
| FR-DASH-17 | The company panel is a horizontally-scrollable strip (fixed tile size, arrow buttons that fade in only when there's more to scroll) rather than a wrapping grid, so a long company list doesn't eat vertical space. | [Done] |

### 1.22 Company short name & regions [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-REF-09 | A company may carry a `short_name` ("IBM" for "International Business Machines") — shown instead of the full name wherever space is tight (dashboard company panel, bubble-view nodes); the full name remains the primary field and is always available on hover. | [Done] |
| FR-REF-10 | A company may be tagged with one or more `regions` (M2M to the existing Country catalog) — optional, and separate from a job listing's precise city/state/country. Powers the dashboard's region map and the Applications region filter (§1.24). | [Done] |

### 1.23 Job Directory (formerly "Catalog") [Done]

Renamed — "Catalog" read as an e-commerce/job-board term given the Job
Listings tab, when the page is actually shared reference data. The nav label,
page title, tour step text and the route itself (`/catalog` -> `/job-directory`)
all changed together; the page's internal component/file naming was renamed
to match rather than left mismatched.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-DIR-01 | Companies, Roles, Places and Job Listings are each **click-to-edit**: clicking a row opens a modal pre-filled with that record, matching the click-through pattern Network and Applications already use. | [Done] |
| FR-DIR-02 | Each edit modal has a delete action behind a two-step confirmation (Delete → Confirm delete), not a single click. | [Done] |
| FR-DIR-03 | A company's logo and regions are editable from the same modal opened by clicking its name — not only from the separate quick-access logo button on the row. | [Done] |
| FR-DIR-04 | List/card rows show only what they're sure of (a set short name, or the full name as fallback) — never an inline input prompting for one; editing happens in the modal. | [Done] |
| FR-DIR-05 | An **industry bubble view**: one ring per industry, its companies as spokes, with the distinct roles seen across that industry's job listings shown as a badge row under the ring (derived from each listing's company + role, since Role itself has no industry field). | [Done] |
| FR-DIR-06 | The "Bring your own AI" import guide (Settings) documents `short_name` and `regions` as optional per-company fields, alongside the existing application/todo/catch-up/person/event shapes. | [Done] |
| FR-DIR-07 | Clicking a company name opens its own **profile page** (`/job-directory/companies/:id`), the same shape as a network contact's: logo, industry and regions on the page, editing behind an **Edit** button rather than straight into a modal from the list. This supersedes FR-DIR-03's "clicking the name opens the modal". | [Done] |
| FR-DIR-08 | The company profile carries a **Job Listings panel** — that company's postings, each click-to-edit — plus a side panel of the applications tied to it, and a New listing action pre-scoped to this company. | [Done] |
| FR-DIR-09 | A job listing has a **description** and free-form **skills** (comma-separated, rendered as highlighted tags). Skills are deliberately per-listing text, not a shared catalog like Role or Location. | [Done] |
| FR-DIR-10 | A listing shows a **LinkedIn marker** with a count when any application covering it recorded LinkedIn as its source (case-insensitive match on the existing free-text `source`, so no new field). The same marker appears on the application's own page beside its source and its "Roles Covered" rows. | [Done] |
| FR-DIR-11 | Company nodes in the industry bubble view link through to the company profile, matching the network bubble view's clickable nodes. | [Done] |
| FR-DIR-12 | The Companies tab leads with **find**, not create: a name search and an industry filter across the top, with creation moved behind an **Add company** button beside them that opens a modal (name, short name, industry, regions). The tab is read far more often than written to. | [Done] |
| FR-NET-17 | **Bubbles is the default view** for Network, matching Job Directory's Companies tab — the rings show who-you-know-where at a glance, which is what the page is usually opened to see. The URL only ever carries an explicit `?view=cards` to override it, never an explicit `?view=bubbles` for the default. | [Done] |
| FR-NET-18 | Each person's node in the bubble view carries a **status-coloured ring** — the same colours `PERSON_STATUS_TONE` badges use elsewhere (lead=warning, connection=good, ghosted=serious), so a lead vs. a connection is visible before hovering, not just in the tooltip. Hover/focus adds a brand-coloured glow *outside* that ring rather than replacing it, so identity doesn't disappear the moment you're pointing at someone. | [Done] |
| FR-DIR-13 | **Bubbles is the default view** for Companies — the rings show industry, size and logos at a glance, which is what the tab is usually opened to survey. | [Done] |
| FR-DIR-14 | The Industries panel has its own **Add** button rather than industries only being creatable in passing from a company form; clicking an industry badge toggles it as the tab's filter. | [Done] |
| FR-MAP-01 | The region map is **pannable and zoomable** — wheel/trackpad zoom about the cursor, drag to pan, and +/−/reset buttons in the lower-right corner (clear of the native resize handle). A drag that moves the map must not also count as a click-through to that country. | [Done] |
| FR-MAP-02 | Land, ocean and border colours are **their own per-theme tokens** (`--map-land`, `--map-ocean`, `--map-stroke`), picked for contrast against each theme's own card surface. Reusing `surface-2` — a hair off `surface` in every theme — left the map close to invisible in light and intern mode. | [Done] |
| FR-MAP-03 | The hover tooltip is anchored to the **country's own centroid** (stored in projection space, mapped through the current pan/zoom), not to a fixed corner and not to the pointer: a corner can sit an ocean away from the country, while a cursor-following tooltip jitters the entire time it's being read. | [Done] |
| FR-MAP-04 | The tooltip is itself **clickable** — same destination as the country, the region-filtered application list, carrying `state.from` so the list's Back link returns to the dashboard. Moving from the country onto its tooltip must not dismiss it, so clearing is deferred ~140ms and cancelled when the pointer lands on the chip. | [Done] |
| FR-MAP-05 | Hover feedback on that chip is a **ripple**, drawn in `--color-ink` rather than the brand colour: on the orange intern palette a brand ripple over a brand-filled country is invisible, whereas ink reads near-black there and in light mode, near-white in dark. The chip stays fully opaque — a brand-tinted fill made it look washed out against the map. | [Done] |

### 1.24 Applications: region filter, card & bubble views [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-APP-13 | A region filter (scoped to `Company.regions`), alongside the existing stage/outcome/company filters, with its own clearable chip. | [Done] |
| FR-APP-14 | A view toggle — **Table** (existing default), **Cards** (a responsive grid, the same card used for the mobile fallback), **Bubbles**. | [Done] |
| FR-APP-15 | Bubble view groups by **stage** or **region** (a secondary toggle, shown only in bubble view) — each a ring of company-initial spokes, click-through to the application. Grouping by recency ("newest vs oldest") was considered and dropped: recency is a continuum with no natural split point for a ring, and the existing "Newest/Oldest first" sort already covers it. | [Done] |
| FR-APP-16 | An application whose company is tagged with several regions appears in every one of those regions' rings — the M2M's actual truth, not an arbitrary pick (same call FR-NET-16 makes for a contact at several companies). | [Done] |

### 1.25 Per-user appearance persistence [Done]

Previously theme/wallpaper/font/preset lived only in `localStorage`, keyed
generically — so two different accounts signed into the same browser saw
each other's picks. Each is now also a field on `Profile`, synced on every
change.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-UI-20 | `Profile` carries `theme_mode`, `wallpaper`, `wallpaper_blur`, `wallpaper_opacity`, `color_preset`, `font_family` — each blank/null until the user picks something, meaning "use the frontend's own default" rather than a specific forced choice. | [Done] |
| FR-UI-21 | Every appearance change is written to `localStorage` immediately (so this device keeps working logged-out, and there's no flash-of-default on reload) **and** PATCHed to the account, best-effort — a failed sync doesn't block the local change, it just means that pick won't follow to another device this time. | [Done] |
| FR-UI-22 | On login, the account's saved appearance applies to the current device once, synchronously (before first paint) — verified against a completely fresh browser profile with no local storage at all, simulating a different device. | [Done] |

### 1.26 Bring-your-own-AI import guide [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-IMPORT-01 | Settings offers a copy-paste prompt (no API key, no live model call) that asks an external AI to reshape pasted tracker data — a spreadsheet, notes, an old export — into a JSON shape matching this app's real field names and enum values. | [Done] |
| FR-IMPORT-02 | Guide-only by design: there is no consuming endpoint yet, so the value today is a well-specified shape the user can save and hand-check, not an automatic import. | [Planned] no import endpoint yet |

### 1.30 Job listing detail page [Done]

The same "click through, land on a real page with an Edit button" pattern as
Company and Person, applied to job listings — previously the only way to see
a listing's full description and skills was the edit modal itself.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-LISTING-01 | Clicking a listing (Job Directory's Listings table, or a company's own Job Listings panel) navigates to `/job-directory/listings/:id` rather than opening the edit modal directly — the modal opens from that page's own **Edit** button. | [Done] |
| FR-LISTING-02 | The page shows the full description and skill tags (not truncated, unlike the table row), role type, work arrangement, dates, a link to the company profile, and a **Linked Applications** panel (`?listing=` filter on `/api/applications/`) — every application that covers this specific role. | [Done] |
| FR-LISTING-03 | A **Delete listing** action in its own Danger Zone. Blocked with a clear message (not a raw 500) when an application still links to it — see FR-DELETE-01. | [Done] |

### 1.29 Job listing import (AI-assisted) [Done]

The tracker-wide import guide (§1.26) is guide-only — no consuming endpoint.
This is the opposite: a narrower, single-listing scope with a real endpoint
behind it, because a job ad's fields (a description vs. a skills list vs. a
deadline) genuinely need an AI to separate them, and the payoff — an actual
browsable listing instead of a wall of pasted text — is worth building the
other half of the round trip for.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-JOBIMPORT-01 | An **Import listing** button next to New listing on the Job Listings tab opens a modal with the copy-paste prompt (`lib/jobImportGuide.ts`) on top and a paste box / file picker underneath — reopening it lands back on the same screen, ready for the AI's reply. | [Done] |
| FR-JOBIMPORT-02 | The prompt asks the AI to separate a pasted job ad into company, role, role_type, work_arrangement, closing_at (deadline), job_url, location, description and skills — skills as short concrete tags pulled from the requirements section, not whole sentences; salary folded into the description as a line if the ad states one. | [Done] |
| FR-JOBIMPORT-03 | `POST /api/job-listings/import_listings/` actually creates the listing: get-or-create on company/role by case-insensitive name, sanitising role_type/work_arrangement/closing_at against the real choices/format rather than trusting the AI's output verbatim. | [Done] |
| FR-JOBIMPORT-04 | **Best-effort, not all-or-nothing**: one bad row in a batch (missing company/role) fails only that row; an unrecognised role_type or an unresolvable location is dropped with a warning rather than rejecting the whole listing. Location in particular is usually skipped — the AI only has a city name, not the full country/state chain this app's Location model needs, and guessing the wrong state is worse than leaving it blank for the user to set from the Places tab. | [Done] |
| FR-JOBIMPORT-05 | Re-importing the same company+role **updates** the existing listing rather than duplicating it. | [Done] |
| FR-JOBIMPORT-06 | The result view lists each row's outcome (added / updated / failed) with its warnings, so a partially-successful import is legible rather than a silent partial success. | [Done] |
| FR-JOBIMPORT-07 | **Copy prompt** sits directly under the prompt textarea it copies, not in the footer alongside the actions that come after the round trip to the AI. The footer's two big buttons are **Import** and **Import file…** — the two ways to actually finish the import — since those are what the user reaches for once they're back with the AI's reply. | [Done] |

### 1.32 @mention autocomplete in notes [Done]

Type `@` in any free-text notes field and it suggests names from the
account's own people and registered locations, narrowing as you keep typing.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-MENTION-01 | `ui/MentionTextarea` wraps a plain textarea with an `@` autocomplete over the account's people and registered locations — a drop-in for `Textarea` (`value`/`onChange` as a plain string, not an event, is the one API difference). Wired into Todo description, contact Notes, catch-up Minutes/Takeaways, and a company's own Notes. | [Done] |
| FR-MENTION-02 | The suggestion list narrows as more of the query is typed (substring match on the person's full name or the location's city name), capped at 8 results, and is positioned at the caret itself — not a fixed corner of the field — via the standard "mirror div" technique (an offscreen div mirrors the textarea's box model and wrapped text up to the caret; the pixel position of a marker at its end is the caret's position). | [Done] |
| FR-MENTION-03 | **Arrow Up/Down** move the highlighted suggestion; **Tab or Enter** accepts the highlighted one without requiring the mouse; **Escape** closes just the suggestion menu. All four call `stopPropagation`, not only `preventDefault` — without it, Escape also closed the surrounding modal (it listens for Escape on `document`), silently discarding whatever had been typed. | [Done] |
| FR-MENTION-04 | Accepting a suggestion inserts `@` + the name with spaces stripped ("Daniel Johnson" → `@DanielJohnson") as literal text, then a trailing space and the caret positioned right after it — the same "quick-mention drops a plain-text token" behaviour as Slack/Notion's `@`, not a relational link. The note stays an ordinary string everywhere else in the app reads it. | [Done] |
| FR-MENTION-05 | A company's own **Notes** field is new (`CompanyNote`, one row per `user`+`company`) rather than a field on `Company` — a company is shared reference data everyone tracking it can see (its logo, its regions), but "recruiter said follow up in March" is one person's private read, not a fact about the company. Explicit **Save note** button, not autosave, since accepting a mention suggestion moves focus and an autosave-on-blur would fire mid-thought. | [Done] |

### 1.33 Per-contact catch-up cadence [Done]

FR-NET-10's 3-month default was a single fixed number for every contact —
someone you deliberately check in with monthly and someone you check in with
once a year had no way to say so.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-CADENCE-01 | `Person.cadence_months` (nullable) overrides the 3-month default: `apply_cadence_default` uses `cadence_months or DEFAULT_CADENCE_MONTHS` when filling a blank `next_chat_at` from `last_meeting_at`, on both create/update and the `log-meeting` action. Null means "use the app default", not "never remind" — that's still a `next_chat_at` of null, unchanged. | [Done] |
| FR-CADENCE-02 | A **Catch-up cadence** select on the contact edit form (Every month / 2 months / 3 months / 6 months / a year, or "Default (3 months)") — the Next chat field's help text reflects whichever cadence is currently chosen. | [Done] |

### 1.31 Deleting shared reference data [Done]

Companies and job listings are shared reference data (FR-AUTH-02) with
PROTECTed foreign keys from listings/applications — by design, so deleting
one never silently orphans another user's application. The gap was that
Django's `ProtectedError` for that case was never caught, so the delete
button simply 500'd with no explanation.

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-DELETE-01 | `CompanyViewSet.destroy` and `JobListingViewSet.destroy` check for referencing rows first and return a **409** with a specific count and reason ("it still has 2 job listings and 1 application") instead of letting `ProtectedError` surface as an unhandled 500. An unreferenced row still deletes normally (204). | [Done] |
| FR-DELETE-02 | No admin/staff gate was needed or added — the failure was a bug (an uncaught exception), not a permissions gap. Every authenticated user can delete a company or listing once nothing protects it, same as before. | [Done] |

### 1.28 Deleting your data [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-ACCT-01 | Settings → Account carries a **Danger zone** with **Delete all my data** — every application, contact, catch-up, todo, calendar event, resume and profile entry on the account. The account itself and its login survive, so the user can start over rather than being signed out into nothing. | [Done] |
| FR-ACCT-02 | Shared reference data (companies, roles, industries, places) is deliberately **not** deleted: it isn't owned by any one user and other accounts point at it. | [Done] |
| FR-ACCT-03 | The purge covers *every* user-scoped model, not just the ones a backup restore rewrites — a leftover calendar event or education entry after a "delete everything" is worse than no button at all. It is therefore its own routine (`accounts/purge.py`), separate from `backup.restore.wipe`. | [Done] |
| FR-ACCT-04 | Confirmation is a modal requiring the word DELETE to be typed, and the endpoint independently requires `{"confirm": true}` — a destructive endpoint must not fire on an empty POST that a retry or prefetch could reproduce. | [Done] |
| FR-COMPANY-01 | A company's profile page has a **Known Connections** panel — the signed-in user's own network contacts tagged with that company (`?company=` on `/api/people/`), each linking to their contact page. | [Done] |
| FR-COMPANY-02 | Company logos render with **rounded corners over their own aspect ratio** (`object-contain`, not cropped), not a circle — a circle crops a wordmark's corners off. People's photos stay circular; `Avatar`/`ImagePicker` take a `shape="circle" \| "square"` prop rather than this being two divergent components. | [Done] |
| FR-COMPANY-03 | Every checkbox-list company/role/listing picker (`MultiSelect` — Resume's target companies, a contact's companies, an application's roles) gets a **search box** once it has more than a handful of options, so it stays usable as the catalog grows past a couple dozen entries. A ticked-but-filtered-out entry stays ticked; searching only hides rows, it never touches the selection. | [Done] |
| FR-NET-19 | The Network page's own company/companies pickers inherit the same search box automatically, being built on the same `MultiSelect`. | [Done] |
| FR-DASH-12 | The dashboard's company panel tiles carry `state: {from: '/'}` on their link to the filtered application list, so a stateful Back to the dashboard appears there — the same mechanism `StatTile` and the region map already use, which this tile had simply been missing. | [Done] |
| FR-ACCT-05 | In that modal the **No** button carries the red, not Yes — deliberately inverted from the usual "destructive action is red" convention so the eye lands on the way out rather than the way through. | [Done] |

### 1.27 Event reminders & notifications [Done]

| ID | Requirement | Status |
| -- | ----------- | ------ |
| FR-NOTIF-01 | A calendar event can be all-day or timed (start/end), and carries any number of **reminders** expressed as minutes before it starts. An all-day event's reminders count back from 09:00 on the day. | [Done] |
| FR-NOTIF-02 | Reminders fire **at the moment they're due**, not on the next poll tick: after each poll the scheduler computes the single soonest un-fired reminder and sets an exact timeout for it. The 20s poll is a discovery/safety net, not the timing mechanism. | [Done] |
| FR-NOTIF-03 | A fired reminder shows an iOS-style banner, plus a native OS notification when the tab is hidden and permission was granted. | [Done] |
| FR-NOTIF-04 | The alert tone is **synthesized** (Web Audio oscillators), not a bundled audio asset — nothing to license or fetch. It's shaped as a struck bell (fundamental plus an inharmonic overtone, fast attack, long tail) rather than a flat sine beep. | [Done] |
| FR-NOTIF-05 | The tone **repeats up to three times** at ~2.2s intervals, and stops immediately when the banner is dismissed — one ding is easy to miss, but it must not nag indefinitely. Each alert holds its own canceller, keyed like the alert. | [Done] |
| FR-NOTIF-06 | A **notifications panel** on the bell in the sidebar, between the profile card and Settings: everything due or overdue in the next 7 days, sorted by date, overdue in the critical tone, each row linking to its record. | [Done] |
| FR-NOTIF-07 | The panel reads the same `dashboard/attention/` feed the dashboard panel does rather than inventing a second notion of "urgent"; the difference is that it's reachable from every page. | [Done] |
| FR-NOTIF-08 | Unread state is per-user and per-browser (`localStorage`, keyed by user id) — "I've read this" is a local reading state, not a shared record — with an unread count badge. Everything listed is marked read when the panel **closes**, not when it opens, so the "new" highlight doesn't vanish from under the reader. | [Done] |
| FR-NOTIF-11 | A reminder that fires is written to a short per-user **history** (`lib/firedAlerts`) and shown in the notifications panel above the due-soon feed. The banner is transient by design, so without this an alert you were away from the screen for left no trace at all. The panel subscribes to that store (and to `storage` events from other tabs), so an alert firing while the panel is open appears in it immediately. | [Done] |
| FR-NOTIF-12 | Fired alerts dismiss out of their own store rather than the due-soon dismissal map, and Clear all empties both. History is capped at 30 entries and 7 days. | [Done] |
| FR-NOTIF-10 | Notifications can be **dismissed individually** (a per-row control, revealed on hover/focus) or **cleared all at once**. A dismissal records the key *and the date it was dismissed for*, so a rescheduled follow-up returns rather than staying hidden because its previous due date was once cleared. | [Done] |
| FR-NOTIF-09 | The desktop sidebar carries `z-40` so popovers anchored inside it sit above `<main>`, which is a later DOM sibling and would otherwise paint over them at the default stacking order. | [Done] |

---

## 2. Requirement detail

### 2.1 Catch-ups & meeting minutes [Done]

A catch-up is a **meeting that happened**, with minutes. Distinct from
`Person.last_meeting_at`, which only records *when* — this records *what*.

| ID | Requirement |
| -- | ----------- |
| FR-CATCH-01 | Catch-ups are a **first-class domain with their own page**, alongside Dashboard / Applications / Network / Todos / Resumes. |
| FR-CATCH-02 | A catch-up belongs to exactly one **person**, and is scoped to the owning user. |
| FR-CATCH-03 | Fields: date, title, format (coffee / call / video / event / message / other), location, **minutes** (long free text), takeaways, follow-up date. |
| FR-CATCH-04 | Logging a catch-up updates the person's `last_meeting_at` and rolls `next_chat_at` forward by the 3-month cadence, honouring an explicit override (FR-NET-10). |
| FR-CATCH-05 | The person's detail page lists their catch-ups in a **"Catch-ups"** panel, newest first — the LinkedIn-style tab pattern. |
| FR-CATCH-06 | From a catch-up, navigate to the person; from a person, navigate to the catch-up. |
| FR-CATCH-07 | List/filter catch-ups by person, format, and date range; search across minutes. |
| FR-CATCH-08 | Catch-ups feed the dashboard activity feed. |
| FR-CATCH-09 | A catch-up may spawn a todo in one action (follow-up from the meeting). |

### 2.2 Navigation state [Done]

| ID | Requirement |
| -- | ----------- |
| FR-NAV-01 | Returning from a detail page restores the **exact list state** it was opened from — bubble vs card view, filters, search, sort. Never a reset to defaults. |
| FR-NAV-02 | List state lives in the URL, so it survives reload, browser back/forward, and link sharing. |

### 2.3 Work experience & galleries [Done]

| ID | Requirement |
| -- | ----------- |
| FR-EXP-01 | The user declares the companies they **work / have worked** for, as Experience entries on their profile. |
| FR-EXP-02 | Experience fields: company (FK to catalog), title, start date, end date (blank = current), description. |
| FR-EXP-03 | Each experience holds a **photo gallery** — many images, each with an optional caption. |
| FR-EXP-04 | Gallery images obey the same validation and re-encoding rules as other uploads (FR-IMG-02). |
| FR-EXP-05 | Experiences and their galleries appear in the **side pane** of the profile page. |
| FR-EXP-06 | Deleting an experience deletes its gallery images from storage, not just their rows. |

### 2.4 Dashboard widgets [Partial]

| ID | Requirement |
| -- | ----------- |
| FR-WIDGET-01 | The dashboard hosts **movable widgets** the user can reorder. |
| FR-WIDGET-02 | Widget layout (order + which are shown) persists per browser. Superseded by FR-WIDGET-07: it now persists per *account*. |
| FR-WIDGET-03 | Initial set: motivational quote, calendar / upcoming dates, photo, and a stats tile. Dummy content is acceptable for a first pass. **The photo widget is still a placeholder** — it should pin an image from an experience gallery. |
| FR-WIDGET-04 | Widgets are reorderable by keyboard as well as pointer — drag must not be the only way. |
| FR-WIDGET-05 | Hiding a widget is non-destructive and reversible. |
| FR-WIDGET-06 | **Every dashboard panel is a widget.** Progress Over Time (with its Companies strip), Pipeline, Needs Attention, Outcomes and Recent Activity moved out of fixed page sections onto the board, so each can be moved, resized, hidden and restored like the rest. A panel that brings its own Card renders "bare" — the board supplies position and an overlaid control cluster instead of wrapping it in a second card. |
| FR-WIDGET-07 | Widgets are **resizable** by column span (1–4 of the board's four), not free pixels — the responsive grid can then honour every size at every breakpoint, and it stays keyboard- and touch-operable. The arrangement (order, hidden set, spans) is saved to `Profile.dashboard_layout`, so it follows the user to another device; `localStorage` keyed by user id remains the immediate layer. |
| FR-WIDGET-08 | An **Arrange → Reset** action restores the default board, so an arrangement can't be painted into a corner. |

### 2.5 Company presence on the dashboard [Done]

| ID | Requirement |
| -- | ----------- |
| FR-DASH-09 | The application chart is accompanied by a **company panel**: small squarish company tiles (logo, or initials as fallback) laid out horizontally and wrapping onto further rows. |
| FR-DASH-10 | Each tile shows the company's application count and links through to the filtered application list. |
| FR-DASH-11 | Tiles are ordered by application count, then name. |

### 2.7 Profile & identity [Done]

Profile is the user's identity and career story; **Settings** is app
preferences (theme, celebrations, backup). Nothing that describes *who the
user is* lives in Settings, and nothing that changes *how the app looks*
lives in Profile.

| ID | Requirement |
| -- | ----------- |
| FR-PROF-01 | Profile and Settings are **separate pages**, reachable from separate nav-adjacent entry points (avatar → Profile, gear icon → Settings). |
| FR-PROF-02 | The dashboard greeting is name-first: "Hi, First Last", falling back to the username when no name is set. |
| FR-PROF-04/05/06 | Registration requires first name, last name, login email, **mobile number** and **LinkedIn URL**. School/work email is optional and stored separately from the login email — the two serve different purposes (auth vs. "how a recruiter reaches me"). |
| FR-PROF-07 | **Important links**: label + URL, add/remove freely, optional at registration so the signup form isn't a wall. |
| FR-PROF-08 | **Addresses**: label + free text, deliberately unstructured rather than street/city/postcode/country fields nobody needs for a personal tracker. |

### 2.8 Career story: Education, Certifications, Extracurriculars [Done]

Three sections, one shared shape: a title, a date range, a description, and
attachments. Modelled as three separate tables (not one generic "career
item" table) because their required fields genuinely differ, but they share
one attachment mechanism via a generic relation.

| ID | Requirement |
| -- | ----------- |
| FR-PROF-10 | Education: institution/programme, start/end date, description, attachments (transcripts, certificates). |
| FR-PROF-11 | Extracurricular: organisation/role, start/end date, description, attachments. |
| FR-PROF-12 | Certification: credential name, issue/expiry date, description, attachments (the certificate itself). |
| FR-PROF-13 | Attachments are an **image or a document** (PDF/Word/etc.), classified by extension and magic-number sniffing, validated and normalized the same way as every other upload in the app. |

### 2.9 Application rejection & reapply [Done]

A rejection isn't necessarily the end of the relationship with a company —
graduate programmes reopen every intake. This is deliberately **not**
restricted to the `rejected` outcome: a reapply date is just a date, settable
on any application.

| ID | Requirement |
| -- | ----------- |
| FR-APP-REJ-01 | Free-text `notes` on the application, for rejection feedback or anything else worth keeping. |
| FR-APP-REJ-02 | `reapply_at`, an optional date, independent of outcome. |
| FR-APP-REJ-03 | A `reapply_at` within the next 7 days appears on the dashboard's attention list, alongside overdue follow-ups — same surfacing mechanism, one more source. |

### 2.10 Calendar [Done]

Read-only aggregation, on purpose: Calendar owns no rows of its own, so it
can never disagree with the page that actually owns a date (a todo's due
date, an application's follow-up). Both the on-page view and the `.ics`
export are built from the same collection function server-side, for the same
reason — one source of truth instead of two renderers that could drift.

| ID | Requirement |
| -- | ----------- |
| FR-CAL-01 | One calendar aggregates: todo due dates, application follow-ups, application reapply reminders, catch-up follow-ups, and network "next chat" dates. |
| FR-CAL-02 | Calendar is in the primary nav, as its own page. |
| FR-CAL-03 | Month view: a 6-week grid plus a side panel for the selected day, each event linking to its actual record. |
| FR-CAL-04 | Year view: twelve compact months, a dot marking any day with an event; clicking a day switches to month view focused on that date. |
| FR-CAL-05 | Domain filter chips (task / follow-up / reapply / catch-up due / meeting follow-up) scope both the grid and the side panel. |
| FR-CAL-06 | Export the visible range to `.ics` — the month in month view, the whole year in year view. |

### 2.11 Appearance v2 [Done]

Three independent axes, layered rather than exclusive: a **theme**
(light/dark/intern/dynamic) sets the base palette and whether the layout is
opaque or glass; a **preset** optionally overrides the colour tokens on top
of that (inline custom properties beat the class-based rules regardless of
which theme is active); a **wallpaper** is a background image, orthogonal to
both.

| ID | Requirement |
| -- | ----------- |
| FR-UI-10 | Upload a personal photo as a wallpaper option, alongside the four built-in images. Stored on `Profile.custom_wallpaper`, contained (not cropped) to 1920px. |
| FR-UI-11 | A wallpaper renders under **any** theme. Picking one no longer forces Intern mode; `data-wallpaper` on `<html>` is set from the wallpaper choice alone, not gated on `theme === 'intern'`. |
| FR-UI-12 | A preset gallery of named colour schemes, each specified as a handful of seed colours (page/surface/ink/brand + two chart accents) and the rest of the token set *derived* from those at apply time. |
| FR-UI-13 | Four presets are firm-branded (PwC, Deloitte, EY, Canva) — public brand colours, personal styling inspiration, not a reproduction of any product's actual UI. |
| FR-UI-14 | A firm-branded preset also carries a **suggested font**, applied in the same click. |
| FR-UI-15 | A font picker: four system fonts (no network fetch) plus ~16 curated Google fonts across sans/serif/mono, loaded on demand via the Google Fonts CSS2 API. Every option renders its own label in its own face. |
| FR-UI-16 | **Dynamic** theme mode: resolves to light or dark from the sun's position at the browser's coordinates (geolocation, cached in `localStorage` so it isn't re-requested every visit), recomputed every 60s so the actual sunrise/sunset moment doesn't need a reload. Falls back to a fixed 07:00–19:00 window when geolocation is unavailable, denied, or times out. |
| FR-UI-17 | In Dynamic mode the header toggle shows a live sun/moon icon instead of the light→dark→intern cycle button; clicking it overrides today's automatic pick and exits Dynamic mode. |
| FR-UI-19 | **Every appearance field is per-account, and signing in is a reset, not a merge.** For theme, wallpaper, blur, opacity, preset and font, login applies the account's saved value *or the default* — never "keep whatever is already in localStorage". Without the default half of that rule, a second account on a shared browser silently inherits the first one's look, which is the bug this rule exists to prevent. |
| FR-UI-21 | Anything that floats over content — dropdown listboxes, popovers, the notifications panel — uses `--color-surface-solid`, an opaque twin of `--color-surface`. Intern mode's surface is deliberately translucent glass, which made a floating option list unreadable: whatever sat underneath showed straight through it. | [Done] |
| FR-UI-22 | Scrollbars are styled slim (6px, rounded, low-contrast) for Chrome/Safari via `::-webkit-scrollbar` as well as Firefox's `scrollbar-width: thin`, which is the only one the bare property covers. | [Done] |
| FR-UI-23 | Horizontal strips (the dashboard's company panel) use a **custom scrollbar** (`ui/ScrollArea`) in the shadcn/Radix ScrollArea mould: the native bar is hidden and a thin rounded thumb is drawn instead, so it renders identically in every browser and takes theme tokens. Built directly rather than adding Radix — a thumb, a track and drag-to-scroll is the whole requirement. | [Done] |
| FR-UI-25 | Each quick-access shortcut has a hover animation themed to what it creates — a stamp press for logging an application, a sonar sweep for a new lead, steam for a coffee chat, a pendulum swing for an event, a pen stroke for a resume, a shelf shimmer for a job listing — over a shared ring that emanates outward from the whole button. All are idle until hover/focus (feedback, not ambient decoration) and all are disabled under `prefers-reduced-motion`. | [Done] |
| FR-UI-26 | The backup actions sit in an even two-by-two grid — the full export and the restore that reads it on top, the two data-only formats paired underneath — rather than a ragged flex wrap. | [Done] |
| FR-UI-24 | That bar is a real control, not decoration: the thumb drags, the track jumps to the pointer, the thumb has a minimum width so it stays grabbable on long strips, and the whole bar is removed from the DOM when there is nothing to scroll. The flex row inside needs `w-max`, since a flex child otherwise stays parent-width and the container's `scrollWidth` never grows. | [Done] |
| FR-UI-20 | The same rule covers non-appearance preferences: `Profile.celebrations_enabled` (null until chosen, so a teammate's "off" doesn't become your default) and `Profile.dashboard_layout` (FR-WIDGET-07). Celebrations live above the auth provider in the tree, so a small in-tree sync component pushes the account's answer down rather than the provider reaching up for it. |
| FR-UI-18 | Page `<h1>` titles are possessive — "My Applications" etc. — the nav labels are not. |
| FR-UI-19 | The Celebrations toggle knob stays inside its track: base position plus translate distance now sum to no more than the track width, in both states. |

### 2.12 Full backup: Data + Resources [Done]

Layered on top of the existing JSON archive rather than replacing it —
`data.json` inside the zip is byte-identical to the plain `.json` export, so
anything that already reads the data-only export can still read the zip's
data half unchanged.

| ID | Requirement |
| -- | ----------- |
| FR-EXPORT-05 | `.zip` export bundles `data.json`, every referenced file (resumes, library documents, profile avatar/wallpaper/pinned photo, experience photos, company logos, person photos, profile-section icons and attachments, profile-link icons, refinement images), and `manifest.json` describing which file belongs to which row. |
| FR-EXPORT-10 | Import reattaches manifest files by **natural key** (label, full name, company name, or company+title+start-date for an experience) against the lookups the JSON restore just built — never by primary key, since restore always creates fresh rows. |
| FR-EXPORT-11 | The Backup panel exposes all three export formats as distinct, clearly-labelled buttons; the summary also reports how many files a "Data + Resources" backup would carry, so the choice isn't blind. |
| FR-EXPORT-12 | A `.zip` upload gets a larger size ceiling (200MB) than a data-only upload (20MB), since it legitimately carries binaries. |

**Coverage guarantee:** `backup/tests.py::test_every_user_owned_field_is_in_the_archive`
walks every concrete field on every user-owned model and fails when one is
missing from `SHEETS`, so a new column can't silently fall out of the backup.
The archive carries every user-owned table (including company short names and
regions, private company notes, per-listing outcomes, listing descriptions and
skills, waiting/historical flags, contact cadence and message history,
connections and per-company titles, education, certifications,
extra-curriculars, profile links and addresses, contact details and name) and
original `created_at` stamps. Left out on purpose: sample-data bookkeeping,
`Venue` (nothing user-owned references it), the `is_developer` trust flag, and
the login email (exported for the record, never restored).

### 2.13 Login experience [Done]

| ID | Requirement |
| -- | ----------- |
| FR-AUTH-04 | Career-focused copy on the split-screen auth layout, replacing generic "sign in to your account" copy. |
| FR-AUTH-05 | A CSS-only 3D card stack (perspective + `preserve-3d`, no WebGL/three.js) tilts toward the pointer — scoped to `mousemove` on the stack's own element, not `window`, so it's inert everywhere else on the page. Skips the pointer-tracking effect under `prefers-reduced-motion`, though the static 3D layout remains. |
| FR-AUTH-06 | A checkmark plays over a fading form on successful sign-in/register, ~550ms before the redirect. Implemented by deferring the `AuthContext` user commit until after the beat, since `GuestRoute`'s redirect fires the instant `user` becomes truthy — committing it early was cutting the animation off before it could render. |
| FR-AUTH-07 | A first-login interactive tour, one step per page, dismissible for good via `Profile.onboarding_completed` — see §1.19 for the full shape (live navigation, per-page "Try it" actions, replay from Settings). |

---

## 2.14 Implementation notes worth keeping

- **Modals render through a portal to `<body>`.** `position: fixed` resolves
  against the nearest ancestor with a transform, filter or `backdrop-filter`,
  and cards carry a backdrop blur in intern mode — so a dialog opened from
  inside a card was being trapped in that card's box.
- **Catch-ups only move a person forward.** A catch-up added retrospectively
  must not rewind `last_meeting_at`; deleting the most recent one recomputes it
  from whatever remains rather than leaving a stale date.
- **List state lives in `sessionStorage`, keyed per list.** The URL stays the
  source of truth; this only records which URL a detail page should return to.
  sessionStorage rather than localStorage so a new tab starts clean.
- **Widgets are reorderable by arrow buttons as well as drag**, because drag is
  unusable by keyboard and awkward on touch.
- **Gallery photos are contained, not cropped** — same reasoning as company
  logos. Only avatars get a square crop.
- **Sunrise/sunset is the general solar-position formula** (mean anomaly →
  equation of the center → ecliptic longitude → hour angle), not the older
  "Almanac for Computers" one-shot formula — that one's final UTC hour gets
  reduced mod 24 partway through, which silently discards which calendar day
  the event actually falls on and puts sunrise *after* sunset for any
  positive-UTC-offset longitude. Verified against known sunrise/transit/sunset
  times for Sydney, London, New York and Tokyo before trusting it.
- **A wallpaper's scrim tint tracks the active theme** (`--wp-tint:
  var(--color-page)`), not a hardcoded colour — it used to assume the one
  Intern/PwC combination, which looked wrong once wallpapers could render
  under Light, Dark or an arbitrary preset too.
- **The success-beat animation needed the `AuthContext` commit delayed, not
  just the `navigate()` call.** Delaying only `navigate()` still let
  `GuestRoute` redirect on its own the moment `setUser` fired inside
  `login()`/`register()`, cutting the checkmark off almost immediately — the
  fix calls the raw API function directly and defers `setUser` itself past the
  animation's `setTimeout`.

---

## 3. Deferred / not planned

Unchanged from the original §2 non-goals: no multi-user teams, no job scraping,
no LMS module. Additionally deferred:

- Rich-text or markdown in meeting minutes (plain text for now).
- Sharing a catch-up or gallery outside the account.
- Object storage for uploads (local `MEDIA_ROOT` until deployment demands it).

---

## 4. Data-integrity rules added by this extension

1. A catch-up's person must belong to the same user as the catch-up.
2. Logging a catch-up never moves `next_chat_at` backwards past the meeting date.
3. An experience's company comes from the shared catalog — no free-text company names.
4. Gallery images are owned by their experience; orphaned files are deleted with the row.
5. Event-log rows remain append-only, including the new `edited` type.

---

## 5. Backlog — captured, not yet built

### 5.1 Backup & export [Done]

| ID | Requirement |
| -- | ----------- |
| FR-EXPORT-01 | All domain data is exportable by the owning user. |
| FR-EXPORT-02 | Export to **spreadsheet** (`.xlsx`), one sheet per domain — applications, event log, network, catch-ups, todos, resumes, experience. |
| FR-EXPORT-03 | Export to a **data file** (`.json`) that can be re-imported. |
| FR-EXPORT-04 | Exports contain only the requesting user's rows, never shared catalog data belonging to others. |
| FR-EXPORT-05 | A `.zip` export bundles the data plus every file it references (resumes, avatar/wallpaper, photos, logos) — see §2.12. `.xlsx`/`.json` remain data-only, referencing files by name. |
| FR-EXPORT-06 | **Both formats import back into the app.** An export that can't be imported is a report, not a backup. |
| FR-EXPORT-07 | Import is a **full replace** — this is disaster recovery, not a merge. It refuses to run without an explicit `mode=replace`. |
| FR-EXPORT-08 | Import offers a **dry run** first, reporting what the file contains, and the UI shows those counts before anything is written. |
| FR-EXPORT-09 | Restore never touches another user's rows, and shared catalog entries are *ensured*, never deleted. |

### 5.2 Celebration on progress [Done]

| ID | Requirement |
| -- | ----------- |
| FR-FX-01 | Submitting a new application plays a brief **fireworks / confetti** effect. |
| FR-FX-02 | Advancing an application to a later stage plays the same effect. |
| FR-FX-05 | The same effect fires on: a catch-up recorded, a new connection added, a todo completed, and an experience added. |
| FR-FX-03 | The effect fires only on genuine forward movement — never on an edit, a no-op save, or a backwards stage change. |
| FR-FX-04 | The effect respects `prefers-reduced-motion` and is skippable; it never blocks input or delays the UI. |

### 5.3 Implementation notes

- **One archive shape, two writers.** `backup/archive.py` builds a single dict;
  the `.xlsx` and `.json` writers render it and the importer reads either back
  into it. The round trip is structural rather than kept in sync by hand.
- **Spreadsheet cells are text**, so id columns have to be coerced back to
  integers on import — otherwise the restore's lookups silently find nothing
  and links (a contact's applications) vanish. Caught by the xlsx round-trip
  test; the JSON path never had the problem.
- **`Content-Disposition` is not CORS-safelisted.** Without
  `CORS_EXPOSE_HEADERS` the SPA can't read the filename off a download, and
  every backup saves under a generic name instead of a dated, user-stamped one.
- **The celebration canvas costs nothing while idle.** One rAF loop that stops
  itself when the last particle dies, `pointer-events: none`, and it does
  nothing at all under `prefers-reduced-motion`.
- **Colours come from live theme tokens**, so a burst in intern mode is PwC
  orange rather than the light theme's blue.
- **The zip's manifest matches by natural key, not primary key.** Restore
  always assigns fresh ids (it's a full replace into whatever's currently in
  the account), so a manifest row keyed by a resume's old id would never
  match anything after restore. Label / full name / company name / experience
  natural key are the same lookups `restore()` already builds for its own
  row-linking, reused rather than duplicated.

### 5.4 Other outstanding items [Planned]

- **Photo widget** (FR-WIDGET-03) still renders a placeholder; it should pin an
  image from an experience gallery.
- **Bring-your-own-AI import** (FR-IMPORT-02) is guide-only — there's no
  endpoint yet that consumes the JSON shape the prompt produces.
- **Import is replace-only.** A merge mode that skips existing rows by natural
  key would make it useful for moving data between accounts, not just recovery.
- **Catch-up → todo in one action** (FR-CATCH-09).
- **Filter catch-ups by date range** (FR-CATCH-07) — the API supports `from` /
  `to`, the UI does not expose them yet.
