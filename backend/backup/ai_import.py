"""Bring-your-own-AI tracker import — the consuming half of
`frontend/src/lib/importGuide.ts`.

Unlike `restore`, this *merges* into the signed-in account: rows from an
existing spreadsheet / notes / other tracker land alongside what's already
here, instead of wiping it. Best-effort per row — one bad application
doesn't sink the batch.
"""

from django.db import DatabaseError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date

from applications.models import (
    Application,
    ApplicationJobListing,
    ApplicationStage,
    Company,
    Country,
    JobListing,
    Outcome,
    Role,
)
from catchups.models import Catchup, CatchupFormat
from events.models import CalendarEvent
from network.models import ContactMethod, Person, PersonStatus, RelationshipTag
from todos.models import Priority, Todo, TodoStatus


def _clean_str(value, *, max_len=None):
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if max_len is not None:
        return text[:max_len]
    return text


def _clean_date(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    return parse_date(value) if len(value) >= 10 else None


def _clean_choice(value, valid):
    if not isinstance(value, str):
        return ""
    value = value.strip().lower()
    return value if value in valid else ""


def _stage_keys():
    return set(ApplicationStage.objects.values_list("key", flat=True))


def _company_for(name, *, short_name="", regions=None, warnings=None):
    """Match existing companies by name or short_name (case-insensitive)."""
    warnings = warnings if warnings is not None else []
    name = _clean_str(name, max_len=255)
    if not name:
        return None

    company = Company.objects.filter(
        Q(name__iexact=name) | Q(short_name__iexact=name)
    ).first()
    if company is None:
        company = Company.objects.create(name=name)
        created = True
    else:
        created = False

    short = _clean_str(short_name, max_len=60)
    if short and not company.short_name:
        company.short_name = short
        company.save(update_fields=["short_name"])

    if isinstance(regions, list):
        for region in regions:
            region_name = _clean_str(region, max_len=100)
            if not region_name:
                continue
            country, _ = Country.objects.get_or_create(name=region_name)
            company.regions.add(country)

    return company, created


def _role_for(name):
    name = _clean_str(name, max_len=255)
    if not name:
        return None
    role = Role.objects.filter(name__iexact=name).first()
    if role is None:
        role = Role.objects.create(name=name)
    return role


def _import_companies(rows, summary):
    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {"section": "companies", "index": index, "error": "Row must be an object."}
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                result = _company_for(
                    row.get("name"),
                    short_name=row.get("short_name") or "",
                    regions=row.get("regions"),
                    warnings=warnings,
                )
                if result is None:
                    raise ValueError("Each company needs a name.")
                _company, created = result
            summary["companies"]["created" if created else "updated"] += 1
            summary["warnings"].extend(
                f"companies[{index}]: {w}" for w in warnings
            )
        except ValueError as exc:
            summary["errors"].append(
                {"section": "companies", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "companies",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _link_roles(application, company, role_names, warnings):
    for role_name in role_names:
        role = _role_for(role_name)
        if not role:
            continue
        listing, listing_created = JobListing.objects.get_or_create(
            company=company,
            role=role,
            location=None,
            opened_at=None,
            defaults={},
        )
        ApplicationJobListing.objects.get_or_create(
            application=application, job_listing=listing
        )
        if listing_created:
            warnings.append(
                f"Added job listing '{role.name}' at {company.name} so this "
                "application could link to a role."
            )


def _import_applications(user, rows, summary):
    valid_outcomes = {c.value for c in Outcome}
    stages = _stage_keys()

    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {
                    "section": "applications",
                    "index": index,
                    "error": "Row must be an object.",
                }
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                company_result = _company_for(row.get("company"), warnings=warnings)
                if company_result is None:
                    raise ValueError("Each application needs a company.")
                company, company_created = company_result
                if company_created:
                    summary["companies"]["created"] += 1

                raw_stage = _clean_str(row.get("stage")).lower()
                if raw_stage and raw_stage not in stages:
                    warnings.append(
                        f"Unrecognised stage '{row['stage']}' — used 'applied'."
                    )
                    stage = "applied"
                else:
                    stage = raw_stage or "applied"

                raw_outcome = _clean_str(row.get("outcome")).lower()
                if raw_outcome and raw_outcome not in valid_outcomes:
                    warnings.append(
                        f"Unrecognised outcome '{row['outcome']}' — used 'in_progress'."
                    )
                    outcome = "in_progress"
                else:
                    outcome = raw_outcome or "in_progress"

                applied_at = _clean_date(row.get("applied_at")) or timezone.localdate()
                if row.get("applied_at") and _clean_date(row.get("applied_at")) is None:
                    warnings.append(
                        f"Unrecognised applied_at '{row['applied_at']}' — used today."
                    )

                role_names = []
                if isinstance(row.get("roles"), list):
                    role_names.extend(_clean_str(r) for r in row["roles"] if _clean_str(r))
                single = _clean_str(row.get("role"))
                if single and single not in role_names:
                    role_names.append(single)

                # Same company + applied day + same role set → skip duplicate.
                existing_qs = Application.objects.filter(
                    user=user, company=company, applied_at=applied_at
                )
                duplicate = None
                for candidate in existing_qs:
                    existing_roles = {
                        link.job_listing.role.name.lower()
                        for link in candidate.listing_links.select_related(
                            "job_listing__role"
                        )
                    }
                    wanted = {r.lower() for r in role_names}
                    if existing_roles == wanted or (not wanted and not existing_roles):
                        duplicate = candidate
                        break

                if duplicate:
                    summary["applications"]["skipped"] += 1
                    continue

                awaiting = bool(row.get("awaiting_response") or row.get("waiting"))
                application = Application.objects.create(
                    user=user,
                    company=company,
                    stage=stage,
                    outcome=outcome,
                    applied_at=applied_at,
                    source=_clean_str(row.get("source"), max_len=100),
                    follow_up_date=_clean_date(row.get("follow_up_date")),
                    reapply_at=_clean_date(row.get("reapply_at")),
                    notes=_clean_str(row.get("notes")),
                    awaiting_response=awaiting,
                    awaiting_since=timezone.now() if awaiting else None,
                    is_historical=True,
                )
                _link_roles(application, company, role_names, warnings)
            summary["applications"]["created"] += 1
            summary["warnings"].extend(
                f"applications[{index}]: {w}" for w in warnings
            )
        except ValueError as exc:
            summary["errors"].append(
                {"section": "applications", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "applications",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _relationship_tag(name):
    name = _clean_str(name, max_len=100)
    if not name:
        return None
    # AI often returns snake_case enum leftovers from older prompts.
    label = name.replace("_", " ").strip().title() if "_" in name else name
    tag = RelationshipTag.objects.filter(name__iexact=label).first()
    if tag is None:
        tag = RelationshipTag.objects.create(name=label)
    return tag


def _add_contact(person, channel, value):
    value = _clean_str(value, max_len=255)
    if not value:
        return False
    ContactMethod.objects.get_or_create(
        person=person,
        channel=channel,
        value=value,
        defaults={"is_preferred": False},
    )
    return True


def _import_people(user, rows, summary):
    valid_status = {c.value for c in PersonStatus}

    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {"section": "people", "index": index, "error": "Row must be an object."}
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                full_name = _clean_str(row.get("full_name"), max_len=255)
                if not full_name:
                    raise ValueError("Each person needs a full_name.")

                status = _clean_choice(row.get("status"), valid_status) or "lead"
                if row.get("status") and _clean_str(row.get("status")).lower() not in valid_status:
                    warnings.append(
                        f"Unrecognised status '{row['status']}' — used 'lead'."
                    )
                    status = "lead"

                person = Person.objects.filter(
                    user=user, full_name__iexact=full_name
                ).first()
                created = person is None
                if created:
                    person = Person(user=user, full_name=full_name)

                person.title = _clean_str(row.get("title"), max_len=255) or person.title
                person.status = status
                tag = _relationship_tag(row.get("relationship"))
                if tag is not None:
                    person.relationship = tag
                if row.get("notes"):
                    person.notes = _clean_str(row.get("notes"))
                if row.get("cadence_months") is not None:
                    try:
                        months = int(row["cadence_months"])
                        if months >= 0:
                            person.cadence_months = months
                    except (TypeError, ValueError):
                        warnings.append(
                            f"Unrecognised cadence_months '{row['cadence_months']}' — left blank."
                        )
                person.save()

                company_name = _clean_str(row.get("company"))
                if company_name:
                    company_result = _company_for(company_name, warnings=warnings)
                    if company_result:
                        company, company_created = company_result
                        if company_created:
                            summary["companies"]["created"] += 1
                        person.companies.add(company)

                _add_contact(person, "email", row.get("email"))
                _add_contact(person, "linkedin", row.get("linkedin"))
                person.apply_cadence_default()
                person.save(update_fields=["next_chat_at"])

            summary["people"]["created" if created else "updated"] += 1
            summary["warnings"].extend(f"people[{index}]: {w}" for w in warnings)
        except ValueError as exc:
            summary["errors"].append(
                {"section": "people", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "people",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _person_for(user, name):
    name = _clean_str(name, max_len=255)
    if not name:
        return None
    person = Person.objects.filter(user=user, full_name__iexact=name).first()
    if person is None:
        person = Person.objects.create(user=user, full_name=name)
    return person


def _import_catchups(user, rows, summary):
    valid_formats = {c.value for c in CatchupFormat}

    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {"section": "catchups", "index": index, "error": "Row must be an object."}
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                person_name = _clean_str(row.get("person"))
                if not person_name:
                    raise ValueError("Each catch-up needs a person.")
                person = _person_for(user, person_name)
                if Person.objects.filter(user=user, full_name__iexact=person_name).count() == 1:
                    # Created above only when missing — track as people created
                    # when this was the first time we saw the name in catchups.
                    pass

                met_on = _clean_date(row.get("met_on"))
                if met_on is None:
                    raise ValueError("Each catch-up needs met_on as YYYY-MM-DD.")

                if Catchup.objects.filter(user=user, person=person, met_on=met_on).exists():
                    summary["catchups"]["skipped"] += 1
                    continue

                fmt = _clean_choice(row.get("format"), valid_formats) or "other"
                if row.get("format") and _clean_str(row.get("format")).lower() not in valid_formats:
                    warnings.append(
                        f"Unrecognised format '{row['format']}' — used 'other'."
                    )
                    fmt = "other"

                follow_up = _clean_date(row.get("follow_up_on"))
                if follow_up and follow_up < met_on:
                    warnings.append("follow_up_on was before met_on — dropped.")
                    follow_up = None

                Catchup.objects.create(
                    user=user,
                    person=person,
                    met_on=met_on,
                    title=_clean_str(row.get("title"), max_len=255),
                    format=fmt,
                    location=_clean_str(row.get("location"), max_len=255),
                    minutes=_clean_str(row.get("minutes")),
                    takeaways=_clean_str(row.get("takeaways")),
                    follow_up_on=follow_up,
                )
                if person.last_meeting_at is None or met_on > person.last_meeting_at:
                    person.last_meeting_at = met_on
                    person.next_chat_at = None
                    person.apply_cadence_default()
                    person.save(update_fields=["last_meeting_at", "next_chat_at"])
            summary["catchups"]["created"] += 1
            summary["warnings"].extend(f"catchups[{index}]: {w}" for w in warnings)
        except ValueError as exc:
            summary["errors"].append(
                {"section": "catchups", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "catchups",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _import_todos(user, rows, summary):
    valid_priority = {c.value for c in Priority}
    valid_status = {c.value for c in TodoStatus}

    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {"section": "todos", "index": index, "error": "Row must be an object."}
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                title = _clean_str(row.get("title"), max_len=255)
                if not title:
                    raise ValueError("Each todo needs a title.")

                priority = _clean_choice(row.get("priority"), valid_priority) or "medium"
                if row.get("priority") and _clean_str(row.get("priority")).lower() not in valid_priority:
                    warnings.append(
                        f"Unrecognised priority '{row['priority']}' — used 'medium'."
                    )
                    priority = "medium"

                status = _clean_choice(row.get("status"), valid_status) or "open"
                company = None
                company_name = _clean_str(row.get("company"))
                if company_name:
                    company_result = _company_for(company_name, warnings=warnings)
                    if company_result:
                        company, company_created = company_result
                        if company_created:
                            summary["companies"]["created"] += 1

                todo = Todo(
                    user=user,
                    title=title,
                    description=_clean_str(row.get("description")),
                    due_date=_clean_date(row.get("due_date")),
                    priority=priority,
                    status=status,
                    company=company,
                )
                todo.sync_completion()
                todo.save()
            summary["todos"]["created"] += 1
            summary["warnings"].extend(f"todos[{index}]: {w}" for w in warnings)
        except ValueError as exc:
            summary["errors"].append(
                {"section": "todos", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "todos",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _import_calendar_events(user, rows, summary):
    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            summary["errors"].append(
                {
                    "section": "calendar_events",
                    "index": index,
                    "error": "Row must be an object.",
                }
            )
            continue
        warnings = []
        try:
            with transaction.atomic():
                title = _clean_str(row.get("title"), max_len=255)
                event_date = _clean_date(row.get("date"))
                if not title or event_date is None:
                    raise ValueError("Each calendar event needs a title and date (YYYY-MM-DD).")

                if CalendarEvent.objects.filter(
                    user=user, title__iexact=title, date=event_date
                ).exists():
                    summary["calendar_events"]["skipped"] += 1
                    continue

                company = None
                company_name = _clean_str(row.get("company"))
                if company_name:
                    company_result = _company_for(company_name, warnings=warnings)
                    if company_result:
                        company, company_created = company_result
                        if company_created:
                            summary["companies"]["created"] += 1

                event = CalendarEvent.objects.create(
                    user=user,
                    title=title,
                    date=event_date,
                    notes=_clean_str(row.get("notes")),
                    company=company,
                    all_day=True,
                )
                people_names = row.get("people")
                if isinstance(people_names, list):
                    for name in people_names:
                        person = _person_for(user, name)
                        if person:
                            event.people.add(person)
            summary["calendar_events"]["created"] += 1
            summary["warnings"].extend(
                f"calendar_events[{index}]: {w}" for w in warnings
            )
        except ValueError as exc:
            summary["errors"].append(
                {"section": "calendar_events", "index": index, "error": str(exc)}
            )
        except DatabaseError as exc:
            summary["errors"].append(
                {
                    "section": "calendar_events",
                    "index": index,
                    "error": f"Couldn't save — {exc}".strip(),
                }
            )


def _empty_bucket():
    return {"created": 0, "updated": 0, "skipped": 0}


def import_tracker_payload(user, payload):
    """Merge a BYO-AI JSON object into the user's account.

    `payload` is the parsed object (not a list). Returns a summary dict suitable
    for the SPA result view.
    """
    if not isinstance(payload, dict):
        raise ValueError(
            'Expected a JSON object like {"applications": [...], "people": [...], ...}.'
        )

    # Reject a full Career Tracker backup masquerading as AI import — those
    # go through Restore, which replaces rather than merges.
    if payload.get("version") is not None and "username" in payload:
        raise ValueError(
            "That looks like a Career Tracker backup (.json export), not the "
            "AI import shape. Use Backup & Restore → Restore… for that file."
        )

    summary = {
        "companies": _empty_bucket(),
        "applications": _empty_bucket(),
        "people": _empty_bucket(),
        "catchups": _empty_bucket(),
        "todos": _empty_bucket(),
        "calendar_events": _empty_bucket(),
        "warnings": [],
        "errors": [],
    }

    _import_companies(payload.get("companies"), summary)
    _import_people(user, payload.get("people"), summary)
    _import_applications(user, payload.get("applications"), summary)
    _import_catchups(user, payload.get("catchups"), summary)
    _import_todos(user, payload.get("todos"), summary)
    _import_calendar_events(user, payload.get("calendar_events"), summary)

    has_any = any(
        summary[key]["created"] or summary[key]["updated"] or summary[key]["skipped"]
        for key in (
            "companies",
            "applications",
            "people",
            "catchups",
            "todos",
            "calendar_events",
        )
    )
    if not has_any and not summary["errors"]:
        raise ValueError(
            "Nothing to import — the JSON had no applications, people, catch-ups, "
            "todos, calendar events, or companies."
        )

    return summary
