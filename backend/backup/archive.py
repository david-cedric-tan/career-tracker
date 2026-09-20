"""One canonical shape for a user's whole account (FR-EXPORT-*).

Both writers (.xlsx and .json) render this dict, and the importer reads either
format back into it. Keeping a single shape is what makes the round trip
honest — an export that can't be imported isn't a backup, it's a report.

Uploaded binaries are referenced by name only in this dict — `.json`/`.xlsx`
exports are data-only. The full "Data + Resources" backup (FR-EXPORT-05) is
a .zip built by `collect_media_manifest` below, layered on top of this same
archive rather than changing its shape. It covers every file field on every
row this archive carries: resumes, library documents, experience photos,
profile avatar/wallpaper/pinned photo, company logos, person photos, the
icon + attachments of each profile section (education, certifications,
extra-curriculars), profile-link icons and refinement message images.

What's deliberately left out: `onboarding.SampleDataRecord` (bookkeeping for
the demo data, which points at rows by id and is meaningless after a restore),
`Venue` (a catalog nothing user-owned references yet), and the login
credentials themselves — `account.email` is exported for the record but never
restored, since it's how you sign in here, not data about you.
"""

import os
import re

from django.utils.text import get_valid_filename

from accounts.models import (
    Certification,
    Education,
    Experience,
    ExperiencePhoto,
    ExtraCurricular,
    Profile,
    ProfileAddress,
    ProfileLink,
    RefinementEventLog,
    RefinementMessage,
    RefinementNote,
)
from applications.models import (
    Application,
    ApplicationJobListing,
    ApplicationStage,
    AppsEventLog,
    Company,
    CompanyNote,
    Country,
    Industry,
    JobListing,
    LibraryDocument,
    Location,
    Resume,
    Role,
    State,
)
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import ContactMethod, Person, PersonCompany
from todos.models import Todo

# Bumped when the shape changes incompatibly, so an old file fails loudly
# rather than importing halfway. New sheets are additive and stay on v1.
ARCHIVE_VERSION = 1

# Sheet/key name → the columns it carries, in order. The importer walks this
# same table, so a column added here flows through both directions.
SHEETS = {
    # The pipeline itself — custom stages an application's `stage` key may
    # point at, which a fresh install won't have until restore ensures them.
    "stages": ["key", "name", "position", "is_preset"],
    "companies": ["id", "name", "short_name", "industries", "regions"],
    "company_notes": ["id", "company", "notes", "updated_at"],
    "roles": ["id", "name"],
    "locations": ["id", "name", "state", "country"],
    "resumes": [
        "id", "label", "variant_type", "notes", "is_active", "file_name",
        "target_companies", "target_roles", "created_at",
    ],
    "job_listings": [
        "id", "company", "role", "location", "role_type", "work_arrangement",
        "opened_at", "closing_at", "job_url", "description", "skills",
    ],
    "applications": [
        "id", "company", "stage", "outcome", "applied_at", "source", "resume",
        "resume_version", "follow_up_date", "reapply_at", "notes", "listings",
        "listing_outcomes", "awaiting_response", "awaiting_since",
        "is_historical", "stage_updated_at", "created_at",
    ],
    "application_events": [
        "id", "application", "event_type", "prev_stage", "curr_stage",
        "prev_outcome", "curr_outcome", "changes", "changed_at", "note",
    ],
    "people": [
        "id", "full_name", "title", "status", "relationship", "source",
        "companies", "applications", "connections", "last_meeting_at",
        "last_messaged_at", "last_message_channel", "next_chat_at",
        "cadence_months", "notes", "created_at",
    ],
    # The detail on each person↔company link (title, dates) — `people.companies`
    # above carries only the names.
    "person_companies": [
        "id", "person", "company", "title", "started_on", "ended_on", "is_current",
        "created_at",
    ],
    "contact_methods": ["id", "person", "channel", "value", "is_preferred"],
    "catchups": [
        "id", "person", "met_on", "title", "format", "format_other",
        "message_channel", "location", "minutes", "takeaways", "follow_up_on",
        "created_at",
    ],
    "todos": [
        "id", "title", "description", "due_date", "due_time", "due_end_time",
        "priority", "status", "application", "person", "company",
        "completed_at", "position", "created_at",
    ],
    "calendar_events": [
        "id", "title", "date", "all_day", "start_time", "end_time", "notes",
        "is_done", "company", "application", "people", "reminders", "created_at",
    ],
    "library_documents": [
        "id", "title", "description", "original_name", "kind", "tags",
        "position", "application", "company", "created_at",
    ],
    "experiences": [
        "id", "company", "title", "started_on", "ended_on", "description",
        "photo_captions", "created_at",
    ],
    "education": [
        "id", "school", "degree", "field_of_study", "started_on", "ended_on",
        "description", "attachment_captions", "created_at",
    ],
    "certifications": [
        "id", "name", "issuer", "issued_on", "expires_on", "credential_url",
        "description", "attachment_captions", "created_at",
    ],
    "extracurriculars": [
        "id", "organization", "role", "started_on", "ended_on", "description",
        "attachment_captions", "created_at",
    ],
    "profile_links": ["id", "label", "url", "category", "position"],
    "profile_addresses": ["id", "label", "address", "country"],
    "refinement_notes": [
        "id", "body", "kind", "status", "page", "screens", "resolution",
        "resolved_at", "resolved_by", "resolution_seen_at", "owner_read_at",
        "developer_read_at", "created_at",
    ],
    "refinement_messages": [
        "id", "note", "body", "author", "created_at", "has_image",
    ],
    "refinement_events": [
        "id", "note", "event_type", "detail", "actor", "created_at",
    ],
}

LIST_SEPARATOR = " | "


def _date(value):
    return value.isoformat() if value else None


def _time(value):
    return value.isoformat() if value else None


def _datetime(value):
    return value.isoformat() if value else None


def _attachment_captions(section):
    """Captions (falling back to original_name) keep zip reattach order stable
    when a profile section has more than one file."""
    return [
        (a.caption or a.original_name or "").strip() for a in section.attachments.all()
    ]


def _names(queryset, attribute="name"):
    return [getattr(row, attribute) for row in queryset]


def build_archive(user):
    """Everything this user owns, as plain JSON-safe rows."""
    applications = (
        Application.objects.filter(user=user)
        .select_related("company", "resume")
        .prefetch_related("listing_links__job_listing", "event_logs")
    )
    resumes = Resume.objects.filter(user=user).prefetch_related(
        "target_companies", "target_roles"
    )
    people = Person.objects.filter(user=user).prefetch_related(
        "companies", "applications__company", "contact_methods", "connections"
    )
    experiences = Experience.objects.filter(user=user).select_related(
        "company"
    ).prefetch_related("photos")

    # Only the catalog rows this user's data actually references — exporting
    # every company in a shared catalog would leak other users' reference data
    # into a personal backup (FR-EXPORT-04).
    company_ids = set(applications.values_list("company_id", flat=True))
    company_ids |= set(experiences.values_list("company_id", flat=True))
    for resume in resumes:
        company_ids |= {c.id for c in resume.target_companies.all()}
    for person in people:
        company_ids |= {c.id for c in person.companies.all()}
    company_ids |= set(
        Todo.objects.filter(user=user, company__isnull=False).values_list(
            "company_id", flat=True
        )
    )
    company_ids |= set(
        CompanyNote.objects.filter(user=user).values_list("company_id", flat=True)
    )
    company_ids |= set(
        CalendarEvent.objects.filter(user=user, company__isnull=False).values_list(
            "company_id", flat=True
        )
    )
    company_ids |= set(
        LibraryDocument.objects.filter(user=user, company__isnull=False).values_list(
            "company_id", flat=True
        )
    )

    listings = JobListing.objects.filter(
        application_links__application__user=user
    ).select_related("company", "role", "location", "location__state").distinct()
    company_ids |= set(listings.values_list("company_id", flat=True))

    companies = Company.objects.filter(id__in=company_ids).prefetch_related(
        "industries", "regions"
    )

    role_ids = set(listings.values_list("role_id", flat=True))
    for resume in resumes:
        role_ids |= {r.id for r in resume.target_roles.all()}
    roles = Role.objects.filter(id__in=role_ids)

    locations = Location.objects.filter(
        id__in=listings.values_list("location_id", flat=True)
    ).select_related("state", "state__country")

    profile = Profile.for_user(user)
    return {
        "version": ARCHIVE_VERSION,
        "username": user.username,
        # Appearance and dashboard layout aren't a "row" like everything else
        # here — one object, not a sheet — so it rides along as its own key
        # rather than forcing SHEETS/archive_counts to special-case it.
        # Name and login email — first/last name are restored, the email is
        # kept for the record only (see the module docstring).
        "account": {
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
        },
        "profile": {
            "preferred_name": profile.preferred_name,
            "mobile_number": profile.mobile_number,
            "school_email": profile.school_email,
            "personal_email": profile.personal_email,
            "linkedin_url": profile.linkedin_url,
            "pinned_photo_caption": profile.pinned_photo_caption,
            "onboarding_completed": profile.onboarding_completed,
            "theme_mode": profile.theme_mode,
            "wallpaper": profile.wallpaper,
            "wallpaper_blur": profile.wallpaper_blur,
            "wallpaper_opacity": profile.wallpaper_opacity,
            "color_preset": profile.color_preset,
            "font_family": profile.font_family,
            "celebrations_enabled": profile.celebrations_enabled,
            "dashboard_layout": profile.dashboard_layout,
        },
        "stages": [
            {
                "key": s.key,
                "name": s.name,
                "position": s.position,
                "is_preset": s.is_preset,
            }
            for s in ApplicationStage.objects.all()
        ],
        "companies": [
            {
                "id": c.id,
                "name": c.name,
                "short_name": c.short_name,
                # A list, not a single value — a company can span more than
                # one industry now.
                "industries": [i.name for i in c.industries.all()],
                "regions": [r.name for r in c.regions.all()],
            }
            for c in companies
        ],
        "company_notes": [
            {
                "id": n.id,
                "company": n.company.name,
                "notes": n.notes,
                "updated_at": _datetime(n.updated_at),
            }
            for n in CompanyNote.objects.filter(user=user).select_related("company")
        ],
        "roles": [{"id": r.id, "name": r.name} for r in roles],
        "locations": [
            {
                "id": l.id,
                "name": l.name,
                "state": l.state.name,
                "country": l.state.country.name,
            }
            for l in locations
        ],
        "resumes": [
            {
                "id": r.id,
                "label": r.label,
                "variant_type": r.variant_type,
                "notes": r.notes,
                "is_active": r.is_active,
                "file_name": r.file_name,
                "target_companies": _names(r.target_companies.all()),
                "target_roles": _names(r.target_roles.all()),
                "created_at": _datetime(r.created_at),
            }
            for r in resumes
        ],
        "job_listings": [
            {
                "id": l.id,
                "company": l.company.name,
                "role": l.role.name,
                "location": l.location.name if l.location else None,
                "role_type": l.role_type,
                "work_arrangement": l.work_arrangement,
                "opened_at": _date(l.opened_at),
                "closing_at": _date(l.closing_at),
                "job_url": l.job_url,
                "description": l.description,
                "skills": l.skills,
            }
            for l in listings
        ],
        "applications": [
            {
                "id": a.id,
                "company": a.company.name,
                "stage": a.stage,
                "outcome": a.outcome,
                "applied_at": _date(a.applied_at),
                "source": a.source,
                "resume": a.resume.label if a.resume else None,
                "resume_version": a.resume_version,
                "follow_up_date": _date(a.follow_up_date),
                "reapply_at": _date(a.reapply_at),
                "notes": a.notes,
                "listings": [
                    link.job_listing.role.name for link in a.listing_links.all()
                ],
                # Only the roles whose result diverges from the application's
                # — blank means "follows the parent", so it isn't recorded.
                "listing_outcomes": {
                    link.job_listing.role.name: link.outcome
                    for link in a.listing_links.all()
                    if link.outcome
                },
                "awaiting_response": a.awaiting_response,
                "awaiting_since": _datetime(a.awaiting_since),
                "is_historical": a.is_historical,
                "stage_updated_at": _datetime(a.stage_updated_at),
                "created_at": _datetime(a.created_at),
            }
            for a in applications
        ],
        "application_events": [
            {
                "id": e.id,
                "application": e.application_id,
                "event_type": e.event_type,
                "prev_stage": e.prev_stage,
                "curr_stage": e.curr_stage,
                "prev_outcome": e.prev_outcome,
                "curr_outcome": e.curr_outcome,
                "changes": e.changes,
                "changed_at": e.changed_at.isoformat(),
                "note": e.note,
            }
            for e in AppsEventLog.objects.filter(application__user=user)
        ],
        "people": [
            {
                "id": p.id,
                "full_name": p.full_name,
                "title": p.title,
                "status": p.status,
                # Names, not FK ids — ids aren't portable across a
                # restore-elsewhere, and these two are open catalogs a
                # restore target may not have the same rows for yet (unlike
                # `company_for`'s get-or-create-by-name below, restored by
                # name on the way back in).
                "relationship": p.relationship.name if p.relationship else None,
                "source": p.source.name if p.source else None,
                "companies": _names(p.companies.all()),
                "applications": [a.id for a in p.applications.all()],
                "connections": _names(p.connections.all(), attribute="full_name"),
                "last_meeting_at": _date(p.last_meeting_at),
                "last_messaged_at": _date(p.last_messaged_at),
                "last_message_channel": p.last_message_channel,
                "next_chat_at": _date(p.next_chat_at),
                "cadence_months": p.cadence_months,
                "notes": p.notes,
                "created_at": _datetime(p.created_at),
            }
            for p in people
        ],
        "person_companies": [
            {
                "id": pc.id,
                "person": pc.person.full_name,
                "company": pc.company.name,
                "title": pc.title,
                "started_on": _date(pc.started_on),
                "ended_on": _date(pc.ended_on),
                "is_current": pc.is_current,
                "created_at": _datetime(pc.created_at),
            }
            for pc in PersonCompany.objects.filter(person__user=user).select_related(
                "person", "company"
            )
        ],
        "contact_methods": [
            {
                "id": c.id,
                "person": c.person.full_name,
                "channel": c.channel,
                "value": c.value,
                "is_preferred": c.is_preferred,
            }
            for c in ContactMethod.objects.filter(person__user=user).select_related("person")
        ],
        "catchups": [
            {
                "id": c.id,
                "person": c.person.full_name,
                "met_on": _date(c.met_on),
                "title": c.title,
                "format": c.format,
                "format_other": c.format_other,
                "message_channel": c.message_channel,
                "location": c.location,
                "minutes": c.minutes,
                "takeaways": c.takeaways,
                "follow_up_on": _date(c.follow_up_on),
                "created_at": _datetime(c.created_at),
            }
            for c in Catchup.objects.filter(user=user).select_related("person")
        ],
        "todos": [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "due_date": _date(t.due_date),
                "due_time": _time(t.due_time),
                "due_end_time": _time(t.due_end_time),
                "priority": t.priority,
                "status": t.status,
                "application": t.application_id,
                "person": t.person.full_name if t.person else None,
                "company": t.company.name if t.company else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "position": t.position,
                "created_at": _datetime(t.created_at),
            }
            for t in Todo.objects.filter(user=user).select_related("person", "company")
        ],
        "calendar_events": [
            {
                "id": e.id,
                "title": e.title,
                "date": _date(e.date),
                "all_day": e.all_day,
                "start_time": _time(e.start_time),
                "end_time": _time(e.end_time),
                "notes": e.notes,
                "is_done": e.is_done,
                "company": e.company.name if e.company else None,
                "application": e.application_id,
                "people": _names(e.people.all(), attribute="full_name"),
                "reminders": [r.minutes_before for r in e.reminders.all()],
                "created_at": _datetime(e.created_at),
            }
            for e in CalendarEvent.objects.filter(user=user)
            .select_related("company", "application")
            .prefetch_related("people", "reminders")
        ],
        "library_documents": [
            {
                "id": d.id,
                "title": d.title,
                "description": d.description,
                "original_name": d.original_name,
                "kind": d.kind,
                "tags": list(d.tags or []),
                "position": d.position,
                "application": d.application_id,
                "company": d.company.name if d.company else None,
                "created_at": _datetime(d.created_at),
            }
            for d in LibraryDocument.objects.filter(user=user).select_related(
                "application", "company"
            )
        ],
        "experiences": [
            {
                "id": e.id,
                "company": e.company.name,
                "title": e.title,
                "started_on": _date(e.started_on),
                "ended_on": _date(e.ended_on),
                "description": e.description,
                "photo_captions": [p.caption for p in e.photos.all()],
                "created_at": _datetime(e.created_at),
            }
            for e in experiences
        ],
        "education": [
            {
                "id": e.id,
                "school": e.school,
                "degree": e.degree,
                "field_of_study": e.field_of_study,
                "started_on": _date(e.started_on),
                "ended_on": _date(e.ended_on),
                "description": e.description,
                "attachment_captions": _attachment_captions(e),
                "created_at": _datetime(e.created_at),
            }
            for e in Education.objects.filter(user=user).prefetch_related("attachments")
        ],
        "certifications": [
            {
                "id": c.id,
                "name": c.name,
                "issuer": c.issuer,
                "issued_on": _date(c.issued_on),
                "expires_on": _date(c.expires_on),
                "credential_url": c.credential_url,
                "description": c.description,
                "attachment_captions": _attachment_captions(c),
                "created_at": _datetime(c.created_at),
            }
            for c in Certification.objects.filter(user=user).prefetch_related(
                "attachments"
            )
        ],
        "extracurriculars": [
            {
                "id": x.id,
                "organization": x.organization,
                "role": x.role,
                "started_on": _date(x.started_on),
                "ended_on": _date(x.ended_on),
                "description": x.description,
                "attachment_captions": _attachment_captions(x),
                "created_at": _datetime(x.created_at),
            }
            for x in ExtraCurricular.objects.filter(user=user).prefetch_related(
                "attachments"
            )
        ],
        "profile_links": [
            {
                "id": l.id,
                "label": l.label,
                "url": l.url,
                "category": l.category,
                "position": l.position,
            }
            for l in ProfileLink.objects.filter(user=user)
        ],
        "profile_addresses": [
            {
                "id": a.id,
                "label": a.label,
                "address": a.address,
                "country": a.country.name if a.country else None,
            }
            for a in ProfileAddress.objects.filter(user=user).select_related("country")
        ],
        "refinement_notes": [
            {
                "id": n.id,
                "body": n.body,
                "kind": n.kind,
                "status": n.status,
                "page": n.page,
                "screens": list(n.screens or []),
                "resolution": n.resolution,
                "resolved_at": n.resolved_at.isoformat() if n.resolved_at else None,
                "resolved_by": n.resolved_by.username if n.resolved_by else None,
                "resolution_seen_at": (
                    n.resolution_seen_at.isoformat() if n.resolution_seen_at else None
                ),
                "owner_read_at": n.owner_read_at.isoformat() if n.owner_read_at else None,
                "developer_read_at": (
                    n.developer_read_at.isoformat() if n.developer_read_at else None
                ),
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in RefinementNote.objects.filter(user=user).select_related(
                "resolved_by"
            )
        ],
        "refinement_messages": [
            {
                "id": m.id,
                "note": m.note_id,
                "body": m.body,
                # Username rather than id — portable across databases; restore
                # maps the archive owner back onto the restoring account.
                "author": m.user.username if m.user_id else None,
                "created_at": m.created_at.isoformat() if m.created_at else None,
                "has_image": bool(m.image),
            }
            for m in RefinementMessage.objects.filter(note__user=user).select_related(
                "user"
            )
        ],
        "refinement_events": [
            {
                "id": e.id,
                "note": e.note_id,
                "event_type": e.event_type,
                "detail": e.detail,
                "actor": e.actor.username if e.actor_id else None,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in RefinementEventLog.objects.filter(note__user=user).select_related(
                "actor"
            )
        ],
    }


def archive_counts(archive):
    """Row counts per sheet — the preview an import shows before committing."""
    return {sheet: len(archive.get(sheet, [])) for sheet in SHEETS}


def _ext(name):
    return os.path.splitext(name or "")[1]


def _caption_filename(attachment, taken):
    """The name a profile attachment is stored under inside the zip.

    The caption is the point of this: someone opening the backup should see
    "AWS Cloud Practitioner.pdf", not "profile_attachments/x7f3k2.pdf". Falls
    back to the uploaded name when there's no caption, and `taken` keeps two
    files captioned the same from colliding into one zip entry.
    """
    label = (attachment.caption or attachment.original_name or "").strip()
    # A caption that already ends in ".pdf" shouldn't come out as ".pdf.pdf".
    stem = get_valid_filename(os.path.splitext(label)[0] or label)
    # `get_valid_filename` drops the slashes but leaves the dots, so a caption
    # like "../../etc/passwd" survives as "....etcpasswd" — no longer a
    # traversal, but still a dot-run that reads as a hidden file.
    stem = re.sub(r"\.{2,}", ".", stem).strip("._-")
    if not stem:
        stem = f"attachment-{attachment.pk}"

    extension = _ext(attachment.file.name) or _ext(attachment.original_name)
    name = f"{stem}{extension}"
    suffix = 2
    while name.lower() in taken:
        name = f"{stem}-{suffix}{extension}"
        suffix += 1
    taken.add(name.lower())
    return name


def collect_media_manifest(user):
    """Every uploaded file this user's archive can reference right now.

    Each entry is `(manifest_row, field_file)` — the zip writer stores the
    field_file's bytes at `manifest_row["path"]` and writes the manifest
    rows into manifest.json, so import can reattach each file to the row the
    JSON restore just recreated. `match` is a natural key rather than a
    primary key, since restore assigns fresh ids.
    """
    entries = []

    profile = Profile.for_user(user)
    if profile.avatar:
        entries.append(
            ({"kind": "profile_avatar", "path": f"media/profile/avatar{_ext(profile.avatar.name)}"}, profile.avatar)
        )
    if profile.custom_wallpaper:
        entries.append(
            (
                {
                    "kind": "profile_wallpaper",
                    "path": f"media/profile/wallpaper{_ext(profile.custom_wallpaper.name)}",
                },
                profile.custom_wallpaper,
            )
        )
    if profile.pinned_photo:
        entries.append(
            (
                {
                    "kind": "profile_pinned_photo",
                    "path": f"media/profile/pinned{_ext(profile.pinned_photo.name)}",
                },
                profile.pinned_photo,
            )
        )

    for resume in Resume.objects.filter(user=user).exclude(file=""):
        entries.append(
            (
                {
                    "kind": "resume",
                    "match": {"label": resume.label},
                    "path": f"media/resumes/{resume.id}{_ext(resume.file.name)}",
                },
                resume.file,
            )
        )

    for document in LibraryDocument.objects.filter(user=user).exclude(file=""):
        entries.append(
            (
                {
                    "kind": "library_document",
                    # The row's own id — not a name, since a document has no
                    # unique title — so restore's fresh copy (looked up by the
                    # id `library_documents` was keyed by while restoring) is
                    # unambiguous even with two documents titled the same.
                    "match": {"id": document.id},
                    "path": f"media/library/{document.id}{_ext(document.file.name)}",
                },
                document.file,
            )
        )

    for experience in Experience.objects.filter(user=user).select_related("company").prefetch_related("photos"):
        key = {
            "company": experience.company.name,
            "title": experience.title,
            "started_on": _date(experience.started_on),
        }
        for index, photo in enumerate(experience.photos.all()):
            if not photo.image:
                continue
            entries.append(
                (
                    {
                        "kind": "experience_photo",
                        "match": key,
                        "caption": photo.caption,
                        "order": index,
                        "path": f"media/experiences/{experience.id}-{index}{_ext(photo.image.name)}",
                    },
                    photo.image,
                )
            )

    company_ids = set(Application.objects.filter(user=user).values_list("company_id", flat=True))
    company_ids |= set(Experience.objects.filter(user=user).values_list("company_id", flat=True))
    company_ids |= set(
        Person.objects.filter(user=user).values_list("companies__id", flat=True)
    )
    company_ids |= set(
        CompanyNote.objects.filter(user=user).values_list("company_id", flat=True)
    )
    company_ids |= set(
        Todo.objects.filter(user=user, company__isnull=False).values_list(
            "company_id", flat=True
        )
    )
    company_ids.discard(None)
    for company in Company.objects.filter(id__in=company_ids).exclude(logo=""):
        entries.append(
            (
                {
                    "kind": "company_logo",
                    "match": {"company": company.name},
                    "path": f"media/companies/{company.id}{_ext(company.logo.name)}",
                },
                company.logo,
            )
        )

    # Education, certifications and extra-curriculars share one shape: an
    # optional icon plus a gallery of attachments, matched back by the row's
    # natural key on restore.
    section_kinds = (
        (
            "education",
            Education,
            lambda row: {"school": row.school, "started_on": _date(row.started_on)},
        ),
        ("certification", Certification, lambda row: {"name": row.name}),
        (
            "extracurricular",
            ExtraCurricular,
            lambda row: {
                "organization": row.organization,
                "started_on": _date(row.started_on),
            },
        ),
    )
    taken_captions = set()
    for kind, model, natural_key in section_kinds:
        for section in model.objects.filter(user=user).prefetch_related("attachments"):
            match = natural_key(section)
            if section.icon:
                entries.append(
                    (
                        {
                            "kind": f"{kind}_icon",
                            "match": match,
                            "path": (
                                f"media/{kind}-icons/"
                                f"{section.id}{_ext(section.icon.name)}"
                            ),
                        },
                        section.icon,
                    )
                )
            for attachment in section.attachments.all():
                if not attachment.file:
                    continue
                entries.append(
                    (
                        {
                            "kind": f"{kind}_attachment",
                            "match": match,
                            "caption": attachment.caption,
                            "original_name": attachment.original_name,
                            "attachment_kind": attachment.kind,
                            "path": (
                                f"media/{kind}s/"
                                f"{_caption_filename(attachment, taken_captions)}"
                            ),
                        },
                        attachment.file,
                    )
                )

    for link in ProfileLink.objects.filter(user=user).exclude(icon=""):
        if not link.icon:
            continue
        entries.append(
            (
                {
                    "kind": "profile_link_icon",
                    "match": {"label": link.label, "url": link.url},
                    "path": f"media/profile-links/{link.id}{_ext(link.icon.name)}",
                },
                link.icon,
            )
        )

    for person in Person.objects.filter(user=user).exclude(photo=""):
        entries.append(
            (
                {
                    "kind": "person_photo",
                    "match": {"full_name": person.full_name},
                    "path": f"media/people/{person.id}{_ext(person.photo.name)}",
                },
                person.photo,
            )
        )

    for message in (
        RefinementMessage.objects.filter(note__user=user)
        .exclude(image="")
        .select_related("note")
    ):
        if not message.image:
            continue
        entries.append(
            (
                {
                    "kind": "refinement_message_image",
                    "match": {
                        "note": message.note_id,
                        "message": message.id,
                        "created_at": (
                            message.created_at.isoformat() if message.created_at else None
                        ),
                    },
                    "path": (
                        f"media/refinements/{message.note_id}-{message.id}"
                        f"{_ext(message.image.name)}"
                    ),
                },
                message.image,
            )
        )

    return entries
