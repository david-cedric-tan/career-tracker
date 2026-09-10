"""Rebuild a user's account from an archive (FR-EXPORT-03).

This is disaster recovery, so the only mode is a full replace: everything the
user owns is removed and recreated from the file. That is destructive by
design, which is why the API refuses to run it without an explicit
`mode=replace` and offers a dry run first.

Shared catalog rows (companies, roles, locations) are *ensured*, never deleted
— they belong to every user, not to the one restoring.
"""

from datetime import datetime

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers

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
from network.models import ContactMethod, MetSourceTag, Person, RelationshipTag
from todos.models import Todo

from .archive import ARCHIVE_VERSION, archive_counts


def _date(value):
    return parse_date(value) if value else None


def _datetime(value):
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None and isinstance(value, datetime):
        return value
    return parsed


def validate_archive(archive):
    version = archive.get("version")
    if version != ARCHIVE_VERSION:
        raise serializers.ValidationError(
            {
                "file": (
                    f"This archive is version {version}, but this app reads "
                    f"version {ARCHIVE_VERSION}."
                )
            }
        )
    return archive


def wipe(user):
    """Remove everything the user owns, in dependency order."""
    # Event logs and junction rows cascade from Application; contact methods
    # and catch-ups cascade from Person.
    Todo.objects.filter(user=user).delete()
    Catchup.objects.filter(user=user).delete()
    Person.objects.filter(user=user).delete()
    Experience.objects.filter(user=user).delete()
    Application.objects.filter(user=user).delete()
    Resume.objects.filter(user=user).delete()


@transaction.atomic
def restore(user, archive):
    """Replace the user's data with the archive.

    Returns `(counts, refs)` — `refs` is the same name → fresh-instance
    lookups built while restoring (companies/resumes/people/experiences),
    reused by `reattach_media` below to hook a zip backup's files onto the
    rows this just recreated, without redoing the matching logic.
    """
    validate_archive(archive)
    wipe(user)

    # --- shared catalogs: ensure, never delete ----------------------------
    companies = {}
    for row in archive.get("companies", []):
        if not row.get("name"):
            continue
        company, _ = Company.objects.get_or_create(name=row["name"])
        # "industries" (a list) is the current shape; "industry" (a single
        # string) is what an older export before the FK->M2M change used —
        # both are accepted so a backup made before that change still restores.
        names = row.get("industries")
        if names is None and row.get("industry"):
            names = [row["industry"]]
        if names:
            industries = [Industry.objects.get_or_create(name=name)[0] for name in names]
            company.industries.add(*industries)
        companies[row["name"]] = company

    roles = {}
    for row in archive.get("roles", []):
        if not row.get("name"):
            continue
        roles[row["name"]], _ = Role.objects.get_or_create(name=row["name"])

    locations = {}
    for row in archive.get("locations", []):
        if not row.get("name"):
            continue
        country, _ = Country.objects.get_or_create(name=row.get("country") or "Unknown")
        state, _ = State.objects.get_or_create(
            country=country, name=row.get("state") or "Unknown"
        )
        locations[row["name"]], _ = Location.objects.get_or_create(
            state=state, name=row["name"]
        )

    def company_for(name):
        if not name:
            return None
        if name not in companies:
            companies[name], _ = Company.objects.get_or_create(name=name)
        return companies[name]

    def role_for(name):
        if not name:
            return None
        if name not in roles:
            roles[name], _ = Role.objects.get_or_create(name=name)
        return roles[name]

    # --- resumes -----------------------------------------------------------
    resumes = {}
    for row in archive.get("resumes", []):
        if not row.get("label"):
            continue
        resume = Resume.objects.create(
            user=user,
            label=row["label"],
            variant_type=row.get("variant_type") or "general",
            notes=row.get("notes") or "",
            is_active=row.get("is_active", True),
            # The binary isn't in the archive; the name is kept so the user can
            # see which file to re-attach.
            file_name=row.get("file_name") or "",
        )
        resume.target_companies.set(
            [c for c in (company_for(n) for n in row.get("target_companies") or []) if c]
        )
        resume.target_roles.set(
            [r for r in (role_for(n) for n in row.get("target_roles") or []) if r]
        )
        resumes[row["label"]] = resume

    # --- job listings ------------------------------------------------------
    listings_by_role = {}
    for row in archive.get("job_listings", []):
        company = company_for(row.get("company"))
        role = role_for(row.get("role"))
        if not company or not role:
            continue
        listing, _ = JobListing.objects.get_or_create(
            company=company,
            role=role,
            location=locations.get(row.get("location")),
            opened_at=_date(row.get("opened_at")),
            defaults={
                "role_type": row.get("role_type") or "",
                "work_arrangement": row.get("work_arrangement") or "",
                "closing_at": _date(row.get("closing_at")),
                "job_url": row.get("job_url") or None,
            },
        )
        listings_by_role[(company.name, role.name)] = listing

    # --- applications ------------------------------------------------------
    applications = {}  # old id → new instance
    for row in archive.get("applications", []):
        company = company_for(row.get("company"))
        if not company:
            continue
        application = Application.objects.create(
            user=user,
            company=company,
            stage=row.get("stage") or "applied",
            outcome=row.get("outcome") or "in_progress",
            applied_at=_date(row.get("applied_at")),
            source=row.get("source") or "",
            resume=resumes.get(row.get("resume")),
            resume_version=row.get("resume_version") or "",
            follow_up_date=_date(row.get("follow_up_date")),
            reapply_at=_date(row.get("reapply_at")),
            notes=row.get("notes") or "",
        )
        for role_name in row.get("listings") or []:
            listing = listings_by_role.get((company.name, role_name))
            if listing:
                ApplicationJobListing.objects.get_or_create(
                    application=application, job_listing=listing
                )
        if row.get("id") is not None:
            applications[row["id"]] = application

    # --- event log (append-only history is part of the backup) -------------
    for row in archive.get("application_events", []):
        application = applications.get(row.get("application"))
        changed_at = _datetime(row.get("changed_at"))
        if not application or not changed_at:
            continue
        AppsEventLog.objects.get_or_create(
            application=application,
            changed_at=changed_at,
            defaults={
                "event_type": row.get("event_type") or "edited",
                "prev_stage": row.get("prev_stage") or "",
                "curr_stage": row.get("curr_stage") or application.stage,
                "prev_outcome": row.get("prev_outcome") or "",
                "curr_outcome": row.get("curr_outcome") or application.outcome,
                "changes": row.get("changes") or [],
                "note": row.get("note") or "",
            },
        )

    # --- network -----------------------------------------------------------
    def relationship_tag_for(name):
        if not name:
            return None
        tag, _ = RelationshipTag.objects.get_or_create(name=name)
        return tag

    def source_tag_for(name):
        if not name:
            return None
        tag, _ = MetSourceTag.objects.get_or_create(name=name)
        return tag

    people = {}
    for row in archive.get("people", []):
        if not row.get("full_name"):
            continue
        person = Person.objects.create(
            user=user,
            full_name=row["full_name"],
            title=row.get("title") or "",
            status=row.get("status") or "lead",
            relationship=relationship_tag_for(row.get("relationship")),
            source=source_tag_for(row.get("source")),
            last_meeting_at=_date(row.get("last_meeting_at")),
            next_chat_at=_date(row.get("next_chat_at")),
            notes=row.get("notes") or "",
        )
        person.companies.set(
            [c for c in (company_for(n) for n in row.get("companies") or []) if c]
        )
        person.applications.set(
            [applications[i] for i in row.get("applications") or [] if i in applications]
        )
        people[row["full_name"]] = person

    for row in archive.get("contact_methods", []):
        person = people.get(row.get("person"))
        if not person or not row.get("value"):
            continue
        ContactMethod.objects.get_or_create(
            person=person,
            channel=row.get("channel") or "other",
            value=row["value"],
            defaults={"is_preferred": row.get("is_preferred", False)},
        )

    for row in archive.get("catchups", []):
        person = people.get(row.get("person"))
        met_on = _date(row.get("met_on"))
        if not person or not met_on:
            continue
        Catchup.objects.create(
            user=user,
            person=person,
            met_on=met_on,
            title=row.get("title") or "",
            format=row.get("format") or "other",
            location=row.get("location") or "",
            minutes=row.get("minutes") or "",
            takeaways=row.get("takeaways") or "",
            follow_up_on=_date(row.get("follow_up_on")),
        )

    # --- todos -------------------------------------------------------------
    for row in archive.get("todos", []):
        if not row.get("title"):
            continue
        todo = Todo(
            user=user,
            title=row["title"],
            description=row.get("description") or "",
            due_date=_date(row.get("due_date")),
            priority=row.get("priority") or "medium",
            status=row.get("status") or "open",
            application=applications.get(row.get("application")),
            person=people.get(row.get("person")),
            company=company_for(row.get("company")),
            completed_at=_datetime(row.get("completed_at")),
        )
        # A hand-edited spreadsheet can claim `done` with no completion stamp;
        # reconcile rather than hitting the DB constraint.
        todo.sync_completion()
        todo.save()

    # --- experience (galleries are files, so only the captions survive here
    #     — reattach_media below re-adds the actual photos from a zip) -------
    experiences = {}
    for row in archive.get("experiences", []):
        company = company_for(row.get("company"))
        started = _date(row.get("started_on"))
        if not company or not row.get("title") or not started:
            continue
        experience, _ = Experience.objects.get_or_create(
            user=user,
            company=company,
            title=row["title"],
            started_on=started,
            defaults={
                "ended_on": _date(row.get("ended_on")),
                "description": row.get("description") or "",
            },
        )
        experiences[(company.name, row["title"], row["started_on"])] = experience

    refs = {
        "companies": companies,
        "resumes": resumes,
        "people": people,
        "experiences": experiences,
    }
    return archive_counts(archive), refs


def reattach_media(user, refs, manifest_rows, media_bytes):
    """Re-attach a zip backup's files to the rows `restore()` just rebuilt.

    Best-effort by design: a row `restore()` skipped (a bad archive row) or a
    file `read_zip_archive` couldn't find just gets silently left without its
    file, rather than failing the whole restore over one photo.
    """
    profile = Profile.for_user(user)
    attached = 0

    for row in manifest_rows:
        data = media_bytes.get(row.get("path"))
        if not data:
            continue
        name = row["path"].rsplit("/", 1)[-1]
        content = ContentFile(data, name=name)
        kind = row.get("kind")
        match = row.get("match") or {}

        if kind == "profile_avatar":
            profile.avatar.save(name, content, save=True)
        elif kind == "profile_wallpaper":
            profile.custom_wallpaper.save(name, content, save=True)
        elif kind == "resume":
            resume = refs["resumes"].get(match.get("label"))
            if resume:
                resume.file.save(name, content, save=True)
        elif kind == "company_logo":
            company = refs["companies"].get(match.get("company"))
            if company:
                company.logo.save(name, content, save=True)
        elif kind == "person_photo":
            person = refs["people"].get(match.get("full_name"))
            if person:
                person.photo.save(name, content, save=True)
        elif kind == "experience_photo":
            key = (match.get("company"), match.get("title"), match.get("started_on"))
            experience = refs["experiences"].get(key)
            if experience:
                ExperiencePhoto.objects.create(
                    experience=experience, image=content, caption=row.get("caption") or ""
                )
        else:
            continue
        attached += 1

    return attached
