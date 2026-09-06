# Career Tracker

Personal career + productivity assistant for tracking job applications, network contacts, resumes, and follow-ups — with a dashboard for progress over time.

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-6.0-092E20?logo=django&logoColor=white)
![Django REST Framework](https://img.shields.io/badge/DRF-API-ff1709?logo=django&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-DB-4169E1?logo=postgresql&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-5-7952B3?logo=bootstrap&logoColor=white)
![Status](https://img.shields.io/badge/status-in%20progress-yellow)

## Core features

- **Application pipeline** — track stages (applied → OA → interviews → offer) and outcomes, with an append-only event history
- **Multi-role applications** — one application can cover multiple roles/listings at the same company
- **Resume library** — store resumes and link them to applications (general / company / role-specific)
- **Network & leads** *(planned)* — people tied to companies, contact channels, meeting cadence
- **Todos / follow-ups** *(planned)* — tasks linked to applications, people, or companies
- **Dashboard** *(planned)* — weekly/monthly progress, funnel stats, activity feed
- **Auth** — login / user-scoped data (API + admin)

## Tech stack

| Layer | Tech |
|-------|------|
| Backend | Django 6, Django REST Framework |
| Auth | Django auth, DRF Token / Session |
| UI (current) | Django templates, Bootstrap 5, Crispy Forms |
| DB (dev) | SQLite |
| Frontend (planned) | Vite / React (CORS ready for `localhost:5173`) |

## Project status

Early backend: models + admin + login. Applications API and SPA frontend coming next.

See [`documentation/functional-requirements.md`](documentation/functional-requirements.md) for the full product vision.
