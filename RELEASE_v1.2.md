# Career Tracker v1.2 — commit & PR copy

Baseline: `adfbc94` on `feat/v1.1` (v1.1 waiting / docs / network).
Working tree: ~180 files, ~+18k / −2.7k lines (uncommitted).

Open `releasenotes.html` beside `releasenotes-shots/` for the illustrated notes.
Also mirrored at `~/Downloads/releasenotes-v1.2.html` + `~/Downloads/releasenotes-shots/`.

---

## Commit message

```
v1.2: File Directory, calendar depth, short names, LAN HTTPS

Replace Resumes with a File Directory (All / application / resume tabs,
scoped search, company-or-application linking). Use company short names
everywhere. Expand calendar (week/day, catch-ups, deadlines, stage moves,
read cards). Separate last met from last messaged. Align Network and Job
Directory bubbles; unify uploads and document viewing; ticket notifs both
ways; run.sh lan --https for home Wi-Fi.
```

Shorter alternative if you prefer a one-liner subject only:

```
v1.2: File Directory, short company names, calendar depth, LAN HTTPS
```

---

## PR title

```
v1.2: File Directory, calendar depth, short names, and LAN HTTPS
```

---

## PR body

```markdown
## Summary

- Replaces Resumes with **File Directory** (`/files`): All / Application Files / Resume Files, scoped search, link files to an application or company, thumbnails, label-based downloads, in-viewer comments.
- **Short company names** end-to-end (serializers, bubbles, lists, pickers, chips); full name for search/tooltip; clickable companies with stateful Back.
- **Calendar**: week/day views, catch-ups on the day, deadline + stage-move entries, colour legend, read card before edit, timed ranges on chips.
- **Catch-ups**: cards default, format icon chips, last met vs last messaged (messages stay off the calendar).
- **Network / Job Directory**: matching bubble grids, industries in a modal, Places defaults to All Places, glass legend.
- **Documents / profile**: shared DocumentViewer + UploadDialog; education/certs/extra-curriculars match experience attachments; preferred name in nav.
- **Tickets / notifs**: both-direction ticket alerts on a Tickets feed; Done requires a reply; Talk to a Dev only while Dev mode is on; theme-proof banners.
- **LAN**: `./run.sh lan --https`, forwarded HTTPS media URLs, access log; mobile overflow / map pinch fixes.

## Test plan

- [ ] File Directory: All / Application / Resume tabs, search scoping, link to company, download uses label name
- [ ] Application / Network / Job Directory bubbles show short names; company chip → company page → Back
- [ ] Calendar: toggle deadlines / stage moves / catch-ups; click item opens view card then Edit
- [ ] Catch-up Messages format updates last messaged only (not last met, not calendar)
- [ ] Profile attach photo/doc via shared dialog; open PDF/Word in viewer
- [ ] Ticket: user message → dev notif; Done with reply → user Tickets feed
- [ ] `./run.sh lan --https`: second device loads images; weather after mkcert trust
- [ ] Known CSRF: if login 403 on another device, clear site cookies / private window (fix not in this PR yet)

## Notes

- Illustrated release notes: `releasenotes.html` + `releasenotes-shots/`
- CSRF login failure over HTTPS LAN is documented as known; do not ship as “fixed”
```
