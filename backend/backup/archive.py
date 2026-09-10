"""One canonical shape for a user's whole account (FR-EXPORT-*).

Both writers (.xlsx and .json) render this dict, and the importer reads either
format back into it. Keeping a single shape is what makes the round trip
honest — an export that can't be imported isn't a backup, it's a report.

Uploaded binaries are referenced by name only in this dict — `.json`/`.xlsx`
exports are data-only. The full "Data + Resources" backup (FR-EXPORT-05) is
a .zip built by `collect_media_manifest` below, layered on top of this same
archive rather than changing its shape. It covers every file field that's
already part of this archive (resumes, experience photos, profile
avatar/wallpaper, company logos, person photos) — Education/Certifications/
ExtraCurriculars and their attachments aren't in this archive shape yet at
all, so their files aren't in the zip either.
"""

import os

from accounts.models import Experience, ExperiencePhoto, Profile
from applications.models import (
    Application,
    ApplicationJobListing,
    AppsEventLog,
    Company,
    Country,
    Industry,
    JobListing,
    Location,
    Resume,
    Role,
    State,
)
from catchups.models import Catchup
from network.models import ContactMethod, Person
from todos.models import Todo

# Bumped when the shape changes incompatibly, so an old file fails loudly
# rather than importing halfway.
ARCHIVE_VERSION = 1

# Sheet/key name → the columns it carries, in order. The importer walks this
# same table, so a column added here flows through both directions.
SHEETS = {
    "companies": ["id", "name", "industries"],
    "roles": ["id", "name"],
    "locations": ["id", "name", "state", "country"],
    "resumes": [
        "id", "label", "variant_type", "notes", "is_active", "file_name",
        "target_companies", "target_roles",
    ],
    "job_listings": [
        "id", "company", "role", "location", "role_type", "work_arrangement",
        "opened_at", "closing_at", "job_url",
    ],
    "applications": [
        "id", "company", "stage", "outcome", "applied_at", "source", "resume",
        "resume_version", "follow_up_date", "reapply_at", "notes", "listings",
    ],
    "application_events": [
        "id", "application", "event_type", "prev_stage", "curr_stage",
        "prev_outcome", "curr_outcome", "changes", "changed_at", "note",
    ],
    "people": [
        "id", "full_name", "title", "status", "relationship", "source",
        "companies", "applications", "last_meeting_at", "next_chat_at", "notes",
    ],
    "contact_methods": ["id", "person", "channel", "value", "is_preferred"],
    "catchups": [
        "id", "person", "met_on", "title", "format", "location", "minutes",
        "takeaways", "follow_up_on",
    ],
    "todos": [
        "id", "title", "description", "due_date", "priority", "status",
        "application", "person", "company", "completed_at",
    ],
    "experiences": [
        "id", "company", "title", "started_on", "ended_on", "description",
        "photo_captions",
    ],
}

LIST_SEPARATOR = " | "


def _date(value):
    return value.isoformat() if value else None


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
        "companies", "applications__company", "contact_methods"
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

    listings = JobListing.objects.filter(
        application_links__application__user=user
    ).select_related("company", "role", "location", "location__state").distinct()
    company_ids |= set(listings.values_list("company_id", flat=True))

    companies = Company.objects.filter(id__in=company_ids).prefetch_related("industries")

    role_ids = set(listings.values_list("role_id", flat=True))
    for resume in resumes:
        role_ids |= {r.id for r in resume.target_roles.all()}
    roles = Role.objects.filter(id__in=role_ids)

    locations = Location.objects.filter(
        id__in=listings.values_list("location_id", flat=True)
    ).select_related("state", "state__country")

    return {
        "version": ARCHIVE_VERSION,
        "username": user.username,
        "companies": [
            {
                "id": c.id,
                "name": c.name,
                # A list, not a single value — a company can span more than
                # one industry now.
                "industries": [i.name for i in c.industries.all()],
            }
            for c in companies
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
                "last_meeting_at": _date(p.last_meeting_at),
                "next_chat_at": _date(p.next_chat_at),
                "notes": p.notes,
            }
            for p in people
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
                "location": c.location,
                "minutes": c.minutes,
                "takeaways": c.takeaways,
                "follow_up_on": _date(c.follow_up_on),
            }
            for c in Catchup.objects.filter(user=user).select_related("person")
        ],
        "todos": [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "due_date": _date(t.due_date),
                "priority": t.priority,
                "status": t.status,
                "application": t.application_id,
                "person": t.person.full_name if t.person else None,
                "company": t.company.name if t.company else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            }
            for t in Todo.objects.filter(user=user).select_related("person", "company")
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
            }
            for e in experiences
        ],
    }


def archive_counts(archive):
    """Row counts per sheet — the preview an import shows before committing."""
    return {sheet: len(archive.get(sheet, [])) for sheet in SHEETS}


def _ext(name):
    return os.path.splitext(name or "")[1]


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

    return entries
