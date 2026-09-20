"""Rebuild a user's account from an archive (FR-EXPORT-03).

This is disaster recovery, so the only mode is a full replace: everything the
user owns is removed and recreated from the file. That is destructive by
design, which is why the API refuses to run it without an explicit
`mode=replace` and offers a dry run first.

Shared catalog rows (companies, roles, locations) are *ensured*, never deleted
— they belong to every user, not to the one restoring.
"""

from datetime import datetime
import os

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.dateparse import parse_date, parse_datetime, parse_time
from rest_framework import serializers

from accounts.models import (
    AttachmentKind,
    Certification,
    Education,
    Experience,
    ExperiencePhoto,
    ExtraCurricular,
    Profile,
    ProfileAddress,
    ProfileAttachment,
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
from events.models import CalendarEvent, EventReminder
from network.models import ContactMethod, MetSourceTag, Person, PersonCompany, RelationshipTag
from onboarding.models import SampleDataRecord
from todos.models import Todo

from .archive import ARCHIVE_VERSION, archive_counts

User = get_user_model()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _date(value):
    return parse_date(value) if value else None


def _datetime(value):
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None and isinstance(value, datetime):
        return value
    return parsed


def _time_value(value):
    return parse_time(value) if value else None


def _backdate(instance, **stamps):
    """Write `auto_now_add`/`auto_now` timestamps from the archive.

    `save()` would stamp "now" over them, so this goes straight to the row.
    A stamp that's missing or unparseable is left as whatever the create set.
    """
    values = {
        field: parsed
        for field, raw in stamps.items()
        if (parsed := _datetime(raw)) is not None
    }
    if values:
        type(instance)._default_manager.filter(pk=instance.pk).update(**values)


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
    # and catch-ups cascade from Person. Refinement messages/events cascade
    # from RefinementNote; certification attachments cascade via GFK cleanup
    # on section delete.
    Todo.objects.filter(user=user).delete()
    CalendarEvent.objects.filter(user=user).delete()
    LibraryDocument.objects.filter(user=user).delete()
    Catchup.objects.filter(user=user).delete()
    Person.objects.filter(user=user).delete()
    Experience.objects.filter(user=user).delete()
    Application.objects.filter(user=user).delete()
    Resume.objects.filter(user=user).delete()
    CompanyNote.objects.filter(user=user).delete()
    Education.objects.filter(user=user).delete()
    Certification.objects.filter(user=user).delete()
    ExtraCurricular.objects.filter(user=user).delete()
    ProfileLink.objects.filter(user=user).delete()
    ProfileAddress.objects.filter(user=user).delete()
    RefinementNote.objects.filter(user=user).delete()
    # Sample-data bookkeeping points at rows by id; every one of those is
    # gone now, so the records would only ever dangle.
    SampleDataRecord.objects.filter(user=user).delete()


def _actor_for(username, restoring_user, archive_username):
    """Map an exported username onto a live User row.

    The archive owner always becomes the restoring account. Anyone else (a
    developer who replied on the ticket) is looked up by username when they
    exist here, otherwise we fall back to the restoring user — message.user
    is required, and losing the text over a missing actor would be worse.
    """
    if not username or username == archive_username:
        return restoring_user
    return User.objects.filter(username=username).first() or restoring_user


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
    archive_username = archive.get("username") or ""

    # --- account name ------------------------------------------------------
    # The email is deliberately not restored: it's the login here, and the
    # archive may be landing in a different account than it came from.
    account_row = archive.get("account") or {}
    name_fields = {
        field: account_row[field]
        for field in ("first_name", "last_name")
        if account_row.get(field)
    }
    if name_fields:
        for field, value in name_fields.items():
            setattr(user, field, value)
        user.save(update_fields=list(name_fields))

    # --- profile: contact details, appearance & dashboard layout -----------
    # Absent (rather than falsy) means an archive from before this was
    # tracked — leave the restoring account's own settings alone.
    profile_row = archive.get("profile")
    if profile_row:
        profile = Profile.for_user(user)
        for field in (
            "preferred_name",
            "mobile_number",
            "school_email",
            "personal_email",
            "linkedin_url",
            "pinned_photo_caption",
            "onboarding_completed",
            "theme_mode",
            "wallpaper",
            "wallpaper_blur",
            "wallpaper_opacity",
            "color_preset",
            "font_family",
            "celebrations_enabled",
            "dashboard_layout",
        ):
            if field in profile_row:
                setattr(profile, field, profile_row[field])
        profile.save()

    # --- shared catalogs: ensure, never delete ----------------------------
    # Pipeline stages are shared too: a custom stage this archive's
    # applications sit in is created if missing, but an existing row's name
    # and order are left alone — they're everyone's pipeline, not this
    # account's. Presets always exist after `migrate`, so only customs land.
    for row in archive.get("stages", []):
        if not row.get("key") or ApplicationStage.objects.filter(key=row["key"]).exists():
            continue
        ApplicationStage.objects.create(
            key=row["key"],
            name=row.get("name") or row["key"],
            is_preset=bool(row.get("is_preset", False)),
        )

    companies = {}
    for row in archive.get("companies", []):
        if not row.get("name"):
            continue
        company, _ = Company.objects.get_or_create(name=row["name"])
        # Shared attributes fill in blanks but never overwrite what another
        # account already set on the same catalog row.
        if row.get("short_name") and not company.short_name:
            company.short_name = row["short_name"]
            company.save(update_fields=["short_name"])
        if row.get("regions"):
            company.regions.add(
                *[Country.objects.get_or_create(name=name)[0] for name in row["regions"]]
            )
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

    # --- private per-company notes ------------------------------------------
    for row in archive.get("company_notes", []):
        company = company_for(row.get("company"))
        if not company or not (row.get("notes") or "").strip():
            continue
        note, _ = CompanyNote.objects.update_or_create(
            user=user, company=company, defaults={"notes": row["notes"]}
        )
        _backdate(note, updated_at=row.get("updated_at"))

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
        _backdate(resume, created_at=row.get("created_at"))
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
                "description": row.get("description") or "",
                "skills": row.get("skills") or "",
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
            awaiting_response=bool(row.get("awaiting_response", False)),
            awaiting_since=_datetime(row.get("awaiting_since")),
            is_historical=bool(row.get("is_historical", False)),
            stage_updated_at=_datetime(row.get("stage_updated_at")),
        )
        # An empty workbook cell parses as [] rather than {} — treat both as
        # "every role follows the application".
        listing_outcomes = row.get("listing_outcomes") or {}
        if not isinstance(listing_outcomes, dict):
            listing_outcomes = {}
        for role_name in row.get("listings") or []:
            listing = listings_by_role.get((company.name, role_name))
            if listing:
                ApplicationJobListing.objects.get_or_create(
                    application=application,
                    job_listing=listing,
                    defaults={"outcome": listing_outcomes.get(role_name) or ""},
                )
        _backdate(application, created_at=row.get("created_at"))
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
            last_messaged_at=_date(row.get("last_messaged_at")),
            last_message_channel=row.get("last_message_channel") or "",
            next_chat_at=_date(row.get("next_chat_at")),
            cadence_months=row.get("cadence_months"),
            notes=row.get("notes") or "",
        )
        person.companies.set(
            [c for c in (company_for(n) for n in row.get("companies") or []) if c]
        )
        person.applications.set(
            [applications[i] for i in row.get("applications") or [] if i in applications]
        )
        _backdate(person, created_at=row.get("created_at"))
        people[row["full_name"]] = person

    # Connections are symmetrical and between people who may appear later in
    # the sheet, so they're wired up once everyone exists.
    for row in archive.get("people", []):
        person = people.get(row.get("full_name"))
        if not person:
            continue
        person.connections.set(
            [p for p in (people.get(n) for n in row.get("connections") or []) if p]
        )

    # The title/dates on each person↔company link. `companies.set()` above
    # already created the bare rows; this fills them in (or adds a link the
    # names list didn't carry).
    for row in archive.get("person_companies", []):
        person = people.get(row.get("person"))
        company = company_for(row.get("company"))
        if not person or not company:
            continue
        link, _ = PersonCompany.objects.update_or_create(
            person=person,
            company=company,
            defaults={
                "title": row.get("title") or "",
                "started_on": _date(row.get("started_on")),
                "ended_on": _date(row.get("ended_on")),
                "is_current": row.get("is_current"),
            },
        )
        _backdate(link, created_at=row.get("created_at"))

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
        catchup = Catchup.objects.create(
            user=user,
            person=person,
            met_on=met_on,
            title=row.get("title") or "",
            format=row.get("format") or "other",
            format_other=row.get("format_other") or "",
            message_channel=row.get("message_channel") or "",
            location=row.get("location") or "",
            minutes=row.get("minutes") or "",
            takeaways=row.get("takeaways") or "",
            follow_up_on=_date(row.get("follow_up_on")),
        )
        _backdate(catchup, created_at=row.get("created_at"))

    # --- todos -------------------------------------------------------------
    for row in archive.get("todos", []):
        if not row.get("title"):
            continue
        todo = Todo(
            user=user,
            title=row["title"],
            description=row.get("description") or "",
            due_date=_date(row.get("due_date")),
            due_time=_time_value(row.get("due_time")),
            due_end_time=_time_value(row.get("due_end_time")),
            priority=row.get("priority") or "medium",
            status=row.get("status") or "open",
            application=applications.get(row.get("application")),
            person=people.get(row.get("person")),
            company=company_for(row.get("company")),
            completed_at=_datetime(row.get("completed_at")),
            position=row.get("position") or 0,
        )
        # A hand-edited spreadsheet can claim `done` with no completion stamp;
        # reconcile rather than hitting the DB constraint.
        todo.sync_completion()
        todo.save()
        _backdate(todo, created_at=row.get("created_at"))

    # --- calendar events -----------------------------------------------------
    for row in archive.get("calendar_events", []):
        event_date = _date(row.get("date"))
        if not row.get("title") or not event_date:
            continue
        event = CalendarEvent.objects.create(
            user=user,
            title=row["title"],
            date=event_date,
            all_day=row.get("all_day", True),
            start_time=_time_value(row.get("start_time")),
            end_time=_time_value(row.get("end_time")),
            notes=row.get("notes") or "",
            is_done=row.get("is_done", False),
            company=company_for(row.get("company")),
            application=applications.get(row.get("application")),
        )
        event.people.set(
            [p for p in (people.get(n) for n in row.get("people") or []) if p]
        )
        for minutes in row.get("reminders") or []:
            EventReminder.objects.get_or_create(event=event, minutes_before=minutes)
        _backdate(event, created_at=row.get("created_at"))

    # --- library documents (files ride along via reattach_media below,
    #     matched on the old id this dict is keyed by) ------------------------
    library_documents = {}  # old id → new instance
    for row in archive.get("library_documents", []):
        if not row.get("title"):
            continue
        document = LibraryDocument.objects.create(
            user=user,
            title=row["title"],
            description=row.get("description") or "",
            original_name=row.get("original_name") or "",
            kind=row.get("kind") or "",
            tags=list(row.get("tags") or []),
            position=row.get("position") or 0,
            application=applications.get(row.get("application")),
            company=company_for(row.get("company")),
        )
        _backdate(document, created_at=row.get("created_at"))
        if row.get("id") is not None:
            library_documents[row["id"]] = document

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
        _backdate(experience, created_at=row.get("created_at"))
        experiences[(company.name, row["title"], row["started_on"])] = experience

    # --- education ---------------------------------------------------------
    education = {}  # (school, started_on) → instance
    for row in archive.get("education", []):
        started = _date(row.get("started_on"))
        if not row.get("school") or not started:
            continue
        school = Education.objects.create(
            user=user,
            school=row["school"],
            degree=row.get("degree") or "",
            field_of_study=row.get("field_of_study") or "",
            started_on=started,
            ended_on=_date(row.get("ended_on")),
            description=row.get("description") or "",
        )
        _backdate(school, created_at=row.get("created_at"))
        education[(row["school"], row["started_on"])] = school

    # --- certifications ----------------------------------------------------
    certifications = {}  # name → instance
    for row in archive.get("certifications", []):
        if not row.get("name"):
            continue
        certification = Certification.objects.create(
            user=user,
            name=row["name"],
            issuer=row.get("issuer") or "",
            issued_on=_date(row.get("issued_on")),
            expires_on=_date(row.get("expires_on")),
            credential_url=row.get("credential_url") or "",
            description=row.get("description") or "",
        )
        _backdate(certification, created_at=row.get("created_at"))
        certifications[row["name"]] = certification

    # --- extra-curriculars -------------------------------------------------
    extracurriculars = {}  # (organization, started_on) → instance
    for row in archive.get("extracurriculars", []):
        started = _date(row.get("started_on"))
        if not row.get("organization") or not started:
            continue
        activity = ExtraCurricular.objects.create(
            user=user,
            organization=row["organization"],
            role=row.get("role") or "",
            started_on=started,
            ended_on=_date(row.get("ended_on")),
            description=row.get("description") or "",
        )
        _backdate(activity, created_at=row.get("created_at"))
        extracurriculars[(row["organization"], row["started_on"])] = activity

    # --- profile links & addresses -----------------------------------------
    profile_links = {}  # (label, url) → instance
    for row in archive.get("profile_links", []):
        if not row.get("label") or not row.get("url"):
            continue
        link = ProfileLink.objects.create(
            user=user,
            label=row["label"],
            url=row["url"],
            category=row.get("category") or "other",
            position=row.get("position") or 0,
        )
        profile_links[(row["label"], row["url"])] = link

    for row in archive.get("profile_addresses", []):
        if not row.get("label") or not row.get("address"):
            continue
        country = None
        if row.get("country"):
            country, _ = Country.objects.get_or_create(name=row["country"])
        ProfileAddress.objects.create(
            user=user, label=row["label"], address=row["address"], country=country
        )

    # --- refinement trail (notes → messages → events) ----------------------
    refinement_notes = {}  # old id → new instance
    refinement_messages = {}  # old id → new instance
    for row in archive.get("refinement_notes", []):
        if not row.get("body"):
            continue
        note = RefinementNote(
            user=user,
            body=row["body"],
            kind=row.get("kind") or "improvement",
            status=row.get("status") or "open",
            page=row.get("page") or "",
            screens=list(row.get("screens") or []),
            resolution=row.get("resolution") or "",
            resolved_at=_datetime(row.get("resolved_at")),
            resolved_by=_actor_for(row.get("resolved_by"), user, archive_username)
            if row.get("resolved_by")
            else None,
            resolution_seen_at=_datetime(row.get("resolution_seen_at")),
            owner_read_at=_datetime(row.get("owner_read_at")),
            developer_read_at=_datetime(row.get("developer_read_at")),
        )
        # Preserve the original raise time so the log reads in the same order.
        created_at = _datetime(row.get("created_at"))
        if created_at is not None:
            note.created_at = created_at
        note.save()
        if row.get("id") is not None:
            refinement_notes[row["id"]] = note

    for row in archive.get("refinement_messages", []):
        note = refinement_notes.get(row.get("note"))
        created_at = _datetime(row.get("created_at"))
        if not note:
            continue
        message = RefinementMessage(
            note=note,
            user=_actor_for(row.get("author"), user, archive_username),
            body=row.get("body") or "",
        )
        if created_at is not None:
            message.created_at = created_at
        message.save()
        if row.get("id") is not None:
            refinement_messages[row["id"]] = message

    for row in archive.get("refinement_events", []):
        note = refinement_notes.get(row.get("note"))
        created_at = _datetime(row.get("created_at"))
        if not note or not row.get("event_type"):
            continue
        event = RefinementEventLog(
            note=note,
            event_type=row["event_type"],
            detail=row.get("detail") or "",
            actor=_actor_for(row.get("actor"), user, archive_username)
            if row.get("actor")
            else None,
        )
        if created_at is not None:
            event.created_at = created_at
        event.save()

    refs = {
        "companies": companies,
        "resumes": resumes,
        "people": people,
        "experiences": experiences,
        "education": education,
        "certifications": certifications,
        "extracurriculars": extracurriculars,
        "profile_links": profile_links,
        "refinement_notes": refinement_notes,
        "refinement_messages": refinement_messages,
        "library_documents": library_documents,
    }
    return archive_counts(archive), refs


def _attachment_kind(filename, explicit=None):
    if explicit in {AttachmentKind.IMAGE, AttachmentKind.DOCUMENT}:
        return explicit
    extension = os.path.splitext(filename or "")[1].lower()
    if extension in IMAGE_EXTENSIONS:
        return AttachmentKind.IMAGE
    return AttachmentKind.DOCUMENT


def reattach_media(user, refs, manifest_rows, media_bytes):
    """Re-attach a zip backup's files to the rows `restore()` just rebuilt.

    Best-effort by design: a row `restore()` skipped (a bad archive row) or a
    file `read_zip_archive` couldn't find just gets silently left without its
    file, rather than failing the whole restore over one photo.

    Older zips shipped certification PDFs in the media tree without matching
    `certifications` rows in data.json — for those, we recreate a shell
    credential from the manifest match name so the PDFs still land.
    """
    profile = Profile.for_user(user)
    attached = 0
    refinement_messages = refs.setdefault("refinement_messages", {})

    # The three profile sections share icon/attachment handling; each is
    # looked up by the natural key its manifest row carries, and a section
    # whose data row is missing (an older media-only zip) is recreated as a
    # shell so its files still land.
    sections = {
        "education": (
            Education,
            refs.setdefault("education", {}),
            lambda m: (m.get("school"), m.get("started_on")),
            lambda m: {"school": m.get("school"), "started_on": _date(m.get("started_on"))},
        ),
        "certification": (
            Certification,
            refs.setdefault("certifications", {}),
            lambda m: m.get("name"),
            lambda m: {"name": m.get("name")},
        ),
        "extracurricular": (
            ExtraCurricular,
            refs.setdefault("extracurriculars", {}),
            lambda m: (m.get("organization"), m.get("started_on")),
            lambda m: {
                "organization": m.get("organization"),
                "started_on": _date(m.get("started_on")),
            },
        ),
    }

    def section_for(prefix, match):
        model, lookup, key_of, fields_of = sections[prefix]
        key = key_of(match)
        fields = fields_of(match)
        if not all(fields.values()):
            return None
        section = lookup.get(key)
        if section is None:
            section, _ = model.objects.get_or_create(user=user, **fields)
            lookup[key] = section
        return section

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
        elif kind == "profile_pinned_photo":
            profile.pinned_photo.save(name, content, save=True)
        elif kind == "profile_link_icon":
            link = refs.get("profile_links", {}).get((match.get("label"), match.get("url")))
            if link:
                link.icon.save(name, content, save=True)
        elif kind == "resume":
            resume = refs["resumes"].get(match.get("label"))
            if resume:
                resume.file.save(name, content, save=True)
        elif kind == "library_document":
            document = refs.get("library_documents", {}).get(match.get("id"))
            if document:
                document.file.save(name, content, save=True)
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
        elif kind.endswith("_icon") and kind[: -len("_icon")] in sections:
            section = section_for(kind[: -len("_icon")], match)
            if section is None:
                continue
            section.icon.save(name, content, save=True)
        elif kind.endswith("_attachment") and kind[: -len("_attachment")] in sections:
            section = section_for(kind[: -len("_attachment")], match)
            if section is None:
                continue
            original_name = (row.get("original_name") or name or "").strip()
            caption = (row.get("caption") or "").strip()
            ProfileAttachment.objects.create(
                content_type=ContentType.objects.get_for_model(type(section)),
                object_id=section.id,
                file=content,
                original_name=original_name,
                kind=_attachment_kind(original_name or name, row.get("attachment_kind")),
                caption=caption,
            )
        elif kind == "refinement_message_image":
            message = refinement_messages.get(match.get("message"))
            if message is None:
                # Fall back when ids shifted but created_at survived the export.
                created_at = _datetime(match.get("created_at"))
                note = refs.get("refinement_notes", {}).get(match.get("note"))
                if note is not None and created_at is not None:
                    message = (
                        RefinementMessage.objects.filter(note=note, created_at=created_at)
                        .order_by("id")
                        .first()
                    )
            if message:
                message.image.save(name, content, save=True)
        else:
            continue
        attached += 1

    return attached
