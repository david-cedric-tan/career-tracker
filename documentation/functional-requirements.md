# Personal Productivity Assistant — Functional Requirements

> **Status:** Draft / brainstorming  
> **Purpose:** Capture the product vision, domains, and functional requirements so we can build in phases without boxing out later integration.  
> **Scope note:** University-specific features (timetable, units, assignments) are **out of scope for now**, but the architecture should leave room for them later.

---

## 1. Vision

A personal assistant for career + productivity that helps you:

1. **Track job applications** end-to-end (pipeline, outcomes, history).
2. **Track people** — connections and “leads” inside companies (who you know, how you know them, how to reach them, when you need to reach them).
3. **Manage todos / follow-ups** tied to applications and people.
4. **See progress** on a unified dashboard (weekly / monthly charts, activity feed).

Mental model: one user, multiple domains, one dashboard that reads across them.

```text
You (User)
 ├── Applications   (companies, roles, stages, event history)
 ├── Resume         (global library; optional target companies/roles)
 ├── Network         (people, contact channels, meeting cadence)
 ├── Todos           (tasks, due dates, reminders, links to apps/people)
 └── Dashboard      (charts + activity — read-only aggregation)
```

---

## 2. Goals & non-goals

### Goals

- Unblock job applications quickly with a usable tracker.
- Avoid duplicate applications / listings / reference data.
- Record network relationships so outreach and follow-ups are intentional.
- Make progress visible (counts, funnels, weekly/monthly trends).
- Keep domains separable so features can ship independently.

### Non-goals (for now)

- Full university LMS / timetable / grade tracking.
- Multi-user team / org features.
- Automated job scraping or LinkedIn sync (nice-to-have later).
- AI chat assistant as a product surface (optional later).
- Share Progress Points with Friends (optional)

---

## 3. Personas / primary user

| Persona           | Needs                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| **You (primary)** | Log apps fast, remember who you met where, follow up, see weekly progress. |

Future (not required now): classmates, mentors viewing shared notes — deferred.

---

## 4. Product domains

### 4.1 Applications (build first)

Track every job application: company, role(s), location(s), stage, outcome, and a history of changes.

### 4.2 Network — connections & leads

Track people linked to companies (and optionally to applications). Distinguish leads / connections / archived / ghosted. Capture **relationship**, **where you met them (source)**, and **contact channels** (LinkedIn, email, WhatsApp, phone, etc.).

Also track meeting cadence:

- `last_meeting_at` — last coffee chat / meetup held
- `next_chat_at` — next scheduled catch-up
- **Default rule:** if `next_chat_at` is blank and `last_meeting_at` is set → set `next_chat_at = last_meeting_at + 3 months`. If the user sets `next_chat_at` explicitly, keep it (do not overwrite).

### 4.3 Resume library

Global resume library owned by the user. Applications point at a resume instead of only storing a free-text label. Resumes can be classified as general, company-specific, or role-specific, with optional target companies/roles for filtering.

### 4.4 Todos / follow-ups

Personal task list that can stand alone or attach to an application, person, or company (e.g. “Follow up with Sarah after OA”).

### 4.5 Dashboard (overarching)

Read-only view that combines application stats, network activity (including chats due / overdue), and todo completion into weekly/monthly progress and an activity feed.

### 4.6 Future: University module (placeholder)

Timetable, assignments, exam prep — same user + activity pattern; not designed in detail yet.

---

## 5. Functional requirements

### 5.1 Identity & account

| ID         | Requirement                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| FR-AUTH-01 | User can register / log in (email + password or equivalent).                 |
| FR-AUTH-02 | All application, network, and todo data is scoped to the authenticated user. |
| FR-AUTH-03 | User profile stores basic identity (name, email).                            |

---

### 5.2 Reference data (shared catalogs)

Used by applications and network.

| ID        | Requirement                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------- |
| FR-REF-01 | Maintain **Companies** with unique names; optional industry.                                            |
| FR-REF-02 | Maintain **Industries** with unique names.                                                              |
| FR-REF-03 | Maintain **Roles** with unique names.                                                                   |
| FR-REF-04 | Maintain **Countries** with unique names.                                                               |
| FR-REF-05 | Maintain **States** unique per country.                                                                 |
| FR-REF-06 | Maintain **Locations** unique per state.                                                                |
| FR-REF-07 | User can create or reuse catalog entries when logging an application or person (no forced pre-seeding). |

---

### 5.3 Job listings

| ID        | Requirement                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-JOB-01 | A job listing belongs to exactly one company.                                                                                                                                                                                                                                         |
| FR-JOB-02 | A listing may represent a posting that covers multiple roles and/or locations over time (EY/KPMG vacationer-style). _Current model may start as one role + one location per listing row; multi-role/location can be junction tables or multiple listing links under one application._ |
| FR-JOB-03 | Optional unique `job_url` to prevent duplicate postings.                                                                                                                                                                                                                              |
| FR-JOB-04 | Capture role type (vacationer/internship, graduate, undergraduate, side-job) and work arrangement (full-time, part-time, casual, contract), separating side-hustles from corpo jobs.                                                                                                  |
| FR-JOB-05 | Open / close dates; closing date must not precede opening date.                                                                                                                                                                                                                       |

---

### 5.4 Applications

| ID        | Requirement                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FR-APP-01 | User can create an application against exactly **one company**.                                                               |
| FR-APP-02 | One application may cover **multiple job listings** (roles/locations) at that company.                                        |
| FR-APP-03 | All linked listings must belong to the application’s company.                                                                 |
| FR-APP-04 | Track **stage**: Not submitted → Applied → Online assessment → Video interview → Assessment centre → Final interview → Offer. |
| FR-APP-05 | Track **outcome**: In progress, Rejected, Offer received, Accepted, Declined, Withdrawn, Ghosted.                             |
| FR-APP-06 | Per-listing outcome may diverge from the parent application outcome when results differ by role.                              |
| FR-APP-07 | Record `applied_at`, optional source, linked **Resume** (FK into global library; legacy `resume_version` string optional), follow-up date, notes. |
| FR-APP-08 | **No duplicate application identity** (stable unique application id per user).                                                |
| FR-APP-09 | **No duplicate apply** for the same user + company + role (+ date policy TBD — see open questions).                           |
| FR-APP-10 | User can list, filter, and sort applications by stage, outcome, company, date.                                                |
| FR-APP-11 | User can update stage/outcome; each meaningful change appends an event log entry.                                             |

---

### 5.5 Application event log

| ID        | Requirement                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------ |
| FR-LOG-01 | Append-only log of stage/outcome transitions (no silent overwrite of history).                   |
| FR-LOG-02 | Store previous/current stage and outcome, timestamp, optional note.                              |
| FR-LOG-03 | No duplicate log rows for the same application at the same timestamp.                            |
| FR-LOG-04 | Only write a log when stage and/or outcome actually changes.                                     |
| FR-LOG-05 | Event log is the primary source for time-series charts (apps per week, stage transitions, etc.). |

---

### 5.6 Network — connections & leads

Person is a **sibling domain under User** (same level as Application / Resume), not nested under an application.

| ID        | Requirement                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-NET-01 | User can create a **person** with name and optional title/role.                                                                                                      |
| FR-NET-02 | A person may be linked to **one or more companies** (M2M).                                                                                                           |
| FR-NET-03 | Status enum: **Lead** \| **Connection** \| **Archived** \| **Ghosted**.                                                                                              |
| FR-NET-04 | **Relationship** enum: mentor, alumni, classmate, colleague, manager, recruiter, interviewer, industry_contact, academic, other.                                     |
| FR-NET-05 | **Source** (where you met them) enum: university_event, professional_event, internship, workplace, class, referral, linkedin, other.                                 |
| FR-NET-06 | Multiple **ContactMethod** rows per person: channel (linkedin, email, whatsapp, phone, instagram, other) + value (URL/handle/address) + `is_preferred`.              |
| FR-NET-07 | Optional M2M link person → **application(s)** (“relevant to my EY application”).                                                                                     |
| FR-NET-08 | Store `last_meeting_at` (nullable date) — last coffee chat / meetup held.                                                                                            |
| FR-NET-09 | Store `next_chat_at` (nullable date) — next scheduled catch-up.                                                                                                      |
| FR-NET-10 | **Cadence default:** if `next_chat_at` is blank and `last_meeting_at` is set → default `next_chat_at = last_meeting_at + 3 months`. Explicit user value is preserved. |
| FR-NET-11 | Free-text notes on the person.                                                                                                                                       |
| FR-NET-12 | No duplicate people for the same user by a sensible key (e.g. unique LinkedIn URL, or name+company — see open questions).                                            |
| FR-NET-13 | User can filter network by company, relationship, source, status, `last_meeting_at`, `next_chat_at` (due / overdue).                                                 |

**Example record**

```text
Person: Sarah Chen
Company: EY
Status: Connection
Relationship: alumni
Source: university_event
Preferred contact: LinkedIn (url…)
Also has: email
Linked applications: EY Vacationer 2026
Last meeting: 2026-06-10
Next chat: 2026-09-10   # defaulted from last meeting + 3 months (or set manually)
```

---

### 5.7 Resume library

| ID         | Requirement                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| FR-RES-01  | User owns a global **Resume** library (not nested under a single application).                                                       |
| FR-RES-02  | Each resume has a unique `label` per user (e.g. `EY-vac-2026`, `v3-tech`).                                                           |
| FR-RES-03  | `variant_type`: general \| company \| role.                                                                                          |
| FR-RES-04  | Optional M2M **target companies** and **target roles** for filtering (“resumes tailored for EY”).                                    |
| FR-RES-05  | Application may link to one Resume via FK (`Application.resume`).                                                                    |
| FR-RES-06  | Resume must belong to the same user as the application.                                                                              |
| FR-RES-07  | Soft-archive via `is_active` (optional). File upload can come later.                                                                 |

---

### 5.8 Todos / tasks

| ID         | Requirement                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-TODO-01 | User can create todos with title, optional description, due date, priority, status (open / done / cancelled).                                          |
| FR-TODO-02 | A todo may optionally link to: an **application**, a **person**, a **company**, or none (standalone).                                                  |
| FR-TODO-03 | Completing a todo records a completion timestamp (feeds dashboard).                                                                                    |
| FR-TODO-04 | Support follow-up style todos auto-suggested from application `follow_up_date` or person `next_chat_at` (soft requirement — UI can create the task). |
| FR-TODO-05 | List / filter by due date, status, linked domain.                                                                                                      |
| FR-TODO-06 | No silent duplicate identical open todos for the same link target + title on the same day (soft uniqueness — confirm later).                           |

---

### 5.9 Dashboard (overarching)

The dashboard **does not own write-truth**. It aggregates reads from applications, network, and todos.

| ID         | Requirement                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| FR-DASH-01 | Show **pipeline snapshot**: counts by application stage / outcome.                                                    |
| FR-DASH-02 | Show **time series**: applications submitted per week/month (from event log).                                         |
| FR-DASH-03 | Show **todo completion** per week/month.                                                                              |
| FR-DASH-04 | Show **network activity**: people added, chats due / overdue (`next_chat_at`), last-meeting ageing.                   |
| FR-DASH-05 | Show a combined **activity feed** (e.g. “Applied to Canva”, “Completed follow-up with Sarah”, “Marked OA done”).      |
| FR-DASH-06 | Support weekly and monthly views.                                                                                     |
| FR-DASH-07 | Clicking an activity item navigates to the underlying application / person / todo.                                    |
| FR-DASH-08 | Implementation may start as query-time unions; later may add a shared `ActivityEvent` table if the feed becomes core. |

---

### 5.10 Cross-domain integration (how it “ties together”)

| ID      | Requirement                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| FR-X-01 | From an **application**, user can see related people at that company and related todos.                                                 |
| FR-X-02 | From a **person**, user can see linked applications/companies and open todos.                                                           |
| FR-X-03 | From a **todo**, user can jump to the linked application or person.                                                                     |
| FR-X-04 | Creating a follow-up on an application or person can create a todo in one flow.                                                         |
| FR-X-05 | All meaningful domain events expose: `user_id`, `occurred_at`, `domain`, `event_type`, short summary — so the dashboard can unify them. |

---

## 6. Data integrity rules (summary)

These are product-level constraints the schema/UI must respect:

1. One application → **one company**; many listings/roles/locations allowed under that company.
2. Linked listings must match the application’s company.
3. Catalog uniqueness: industry, role, country, state-per-country, location-per-state, company name.
4. Application event logs are append-only; unique per application + timestamp.
5. Resume labels unique per user; application resume FK must belong to the same user.
6. People have status + relationship + source + preferred contact channel.
7. If `next_chat_at` is unset and `last_meeting_at` is set → default next chat to last meeting + 3 months; never overwrite an explicit next-chat date.
8. Todos and network integrate with applications via optional foreign links — not by stuffing fields into one mega-table.

---

## 7. Suggested phasing

### Phase 0 — Unblock applying (now)

- Auth + Companies + Applications + Listings + Stage/Outcome + Event log
- Global Resume library + Application.resume FK
- Simple list/filter UI (admin is fine initially)
- **Ship this first**

### Phase 1 — Network

- Person (status / relationship / source), ContactMethod
- Link person → company (± application)
- `last_meeting_at` / `next_chat_at` with 3-month default cadence

### Phase 2 — Todos

- Standalone todos + links to application/person
- Due dates + completion events

### Phase 3 — Dashboard

- Application stats charts
- Todo completion charts
- Combined activity feed
- Weekly / monthly toggles

### Phase 4 — University module (later)

- Same activity + todo patterns; new domain entities

---

## 8. Non-functional requirements (light)

| ID     | Requirement                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| NFR-01 | Prefer simple CRUD APIs / Django models that map cleanly to constraints.                    |
| NFR-02 | Domains should be separable apps/modules (`applications`, `network`, `todos`, `dashboard`). |
| NFR-03 | Dashboard remains a read layer; domains own their write truth.                              |
| NFR-04 | Mobile-friendly UI later; desktop-first is fine for Phase 0–1.                              |
| NFR-05 | Privacy: personal CRM data stays private to the user account.                               |

---

## 9. Open questions (brainstorming)

Use these in design sessions; answers will harden the schema.

1. **Application uniqueness:** block same user + company + role + **calendar day**, or one application per company per day regardless of roles?
2. **Multi-role listings:** keep multiple `JobListing` rows linked to one `Application`, or introduce `JobListingRole` / `JobListingLocation` M2M on a single posting?
3. **Person uniqueness:** unique by LinkedIn URL? email? name + company?
4. **Activity store:** stay with query-time union until Phase 3, or introduce `ActivityEvent` earlier?
5. **Reminders:** in-app only vs email/push later?
6. **Cadence length:** stick to fixed **3 months**, or allow per-person cadence (3 vs 6 months)?
7. **When last meeting updates:** clear `next_chat_at` so it recalculates, or leave the existing next-chat alone?

**Decided (for now):**

- Leads vs connections → **one `Person` model** with a `status` field (not separate tables).
- Multiple companies per person → **M2M** in v1.
- Relationship / source → **fixed enums + other** (not free-form tags only).

---

## 10. Glossary

| Term                | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Application**     | Your submission / candidacy at a company (may cover multiple roles).                         |
| **Job listing**     | A concrete posting (URL, role, location, dates).                                             |
| **Stage**           | Where you are in the hiring pipeline.                                                        |
| **Outcome**         | Result status of the application or a specific role.                                         |
| **Event log**       | Append-only history of stage/outcome changes.                                                |
| **Resume**          | Entry in the user’s global resume library; applications may link to one.                     |
| **Lead**            | Someone identified as a potential contact; relationship not solid yet.                       |
| **Connection**      | Someone with an established professional relationship.                                       |
| **Ghosted**         | Contacted with no response after an appropriate follow-up period.                            |
| **Archived**        | Contact no longer actively tracked / reminded.                                               |
| **Relationship**    | Nature of the tie (mentor, alumni, recruiter, …).                                            |
| **Source**          | Where you met them (uni event, LinkedIn, workplace, …).                                      |
| **Contact channel** | How you reach them (LinkedIn, WhatsApp, email, phone, …).                                    |
| **Last meeting**    | Date of the last coffee chat / meetup held (`last_meeting_at`).                              |
| **Next chat**       | Date of the next scheduled catch-up (`next_chat_at`); defaults to last meeting + 3 months.   |
| **Todo**            | A task, often a follow-up, optionally linked to an app or person.                            |
| **Dashboard**       | Aggregated progress view across domains.                                                     |

---

## 11. One-page story (acceptance flavour)

> I apply to EY’s vacationer program (multiple streams/locations) as **one application**, using my **EY-tailored resume** from the library.  
> I log **Sarah** as a connection (relationship: alumni, source: university event); preferred contact is LinkedIn.  
> We met on 2026-06-10; I leave next chat blank → system sets **2026-09-10** (last meeting + 3 months).  
> I create a todo: “Message Sarah after OA” due next week, linked to both the application and Sarah.  
> When I pass OA, the application stage updates and an event is logged.  
> On my **weekly dashboard**, I see: 4 applications submitted, 1 stage advance, chats due (Sarah), 3 todos done.

That loop — **apply → network → follow up → see progress** — is the product.

---

## 12. Related implementation notes (current codebase)

- Django app `applications` already models Country / State / Location, Industry, Company, Role, Resume, JobListing, Application, ApplicationJobListing, AppsEventLog.
- Network (`Person` / `ContactMethod`), Todos, and Dashboard modules are **not built yet**; this document defines what they should do when added.
- Prefer extending via new Django apps rather than overloading `applications` once Phase 1 starts.
