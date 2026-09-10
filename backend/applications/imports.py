"""Job listing import — the consuming half of the "bring your own AI" prompt
in `frontend/src/lib/jobImportGuide.ts`.

The user pastes a real job ad into an AI (ChatGPT, Claude, whatever they
already have) using that prompt, which asks it to separate the ad into the
tracker's own fields — company, role, description, skills, deadline — rather
than dumping the whole page as one blob. This is where that JSON lands.

Deliberately forgiving: a listing with an unresolvable location or an unknown
role_type still imports, just without that one field, rather than the whole
import failing over one bad row. `location` in particular is common to skip —
the AI usually has only a city name, not the full country/state chain this
app's Location model needs, and guessing the wrong state is worse than
leaving it blank for the user to set from the Places tab.
"""

from django.core.exceptions import ValidationError
from django.db import DatabaseError, transaction
from django.db.models import Q

from .models import Company, JobListing, Location, Role, RoleType, WorkArrangement

VALID_ROLE_TYPES = {choice.value for choice in RoleType}
VALID_WORK_ARRANGEMENTS = {choice.value for choice in WorkArrangement}


def _clean_choice(value, valid):
    if not isinstance(value, str):
        return ""
    value = value.strip().lower()
    return value if value in valid else ""


def _clean_date(value):
    """YYYY-MM-DD only — anything else is dropped rather than guessed at."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if len(value) == 10 and value[4] == "-" and value[7] == "-":
        return value
    return None


def import_listing(row):
    """Creates or updates one JobListing from an import row.

    Returns (listing, created, warnings) — warnings are field-level notes
    ("location not found, skipped") rather than exceptions, since a partial
    listing is still worth having.
    """
    warnings = []

    company_name = (row.get("company") or "").strip()
    role_name = (row.get("role") or "").strip()
    if not company_name or not role_name:
        raise ValueError("Each listing needs at least a company and a role.")

    # Matched against both names, case-insensitively — "CommBank" has to find
    # "Commonwealth Bank" (short_name="CommBank") and vice versa, or the same
    # employer ends up duplicated under whichever name a given ad happened to
    # use, splitting its applications/listings across two rows.
    company = Company.objects.filter(
        Q(name__iexact=company_name) | Q(short_name__iexact=company_name)
    ).first()
    if company is None:
        company = Company.objects.create(name=company_name)
        warnings.append(
            f"'{company_name}' didn't match an existing company — added it as a new one. "
            "If it should have matched one you already track, check for a typo, or set it "
            "as that company's short name."
        )

    role = Role.objects.filter(name__iexact=role_name).first()
    if role is None:
        role = Role.objects.create(name=role_name)

    role_type = _clean_choice(row.get("role_type"), VALID_ROLE_TYPES)
    if row.get("role_type") and not role_type:
        warnings.append(f"Unrecognised role_type '{row['role_type']}' — left blank.")

    work_arrangement = _clean_choice(row.get("work_arrangement"), VALID_WORK_ARRANGEMENTS)
    if row.get("work_arrangement") and not work_arrangement:
        warnings.append(f"Unrecognised work_arrangement '{row['work_arrangement']}' — left blank.")

    closing_at = _clean_date(row.get("closing_at"))
    if row.get("closing_at") and not closing_at:
        warnings.append(f"Unrecognised closing_at date '{row['closing_at']}' — left blank.")

    opened_at = _clean_date(row.get("opened_at"))

    job_url = (row.get("job_url") or "").strip() or None
    description = (row.get("description") or "").strip()
    skills_list = row.get("skills")
    if isinstance(skills_list, list):
        skills = ", ".join(str(item).strip() for item in skills_list if str(item).strip())
    else:
        skills = (skills_list or "").strip()

    # An ad almost always names just the city ("Sydney"), so match on that
    # case-insensitively rather than demanding the full country/state chain —
    # same reasoning as the company match above. Only an actual miss, or a
    # city name that exists in two different states, is worth a warning.
    location = None
    location_name = (row.get("location") or "").strip()
    if location_name:
        matches = list(
            Location.objects.filter(name__iexact=location_name).select_related(
                "state", "state__country"
            )[:2]
        )
        if len(matches) == 1:
            location = matches[0]
        elif len(matches) > 1:
            warnings.append(
                f"'{location_name}' matches more than one city in your Places — "
                "set the right one on this listing yourself."
            )
        else:
            warnings.append(
                f"Location '{location_name}' isn't in your Places yet — add it from the "
                "Places tab, then set it on this listing."
            )

    # Dedup, most reliable key first. `job_url` is unique across the whole
    # table, so re-importing the same posting must find it here — otherwise
    # the create below dies on an IntegrityError instead of just updating.
    existing = None
    if job_url:
        existing = JobListing.objects.filter(job_url=job_url).first()
    if existing is None:
        existing = JobListing.objects.filter(
            company=company, role=role, location=location, opened_at=opened_at
        ).first()
    if existing is None and location is not None:
        # Same posting imported back when its city couldn't be matched — fill
        # the city in on that row rather than leaving a near-identical pair.
        existing = JobListing.objects.filter(
            company=company, role=role, location=None, opened_at=opened_at
        ).first()

    if existing:
        existing.location = existing.location or location
        existing.role_type = role_type or existing.role_type
        existing.work_arrangement = work_arrangement or existing.work_arrangement
        existing.closing_at = closing_at or existing.closing_at
        existing.job_url = job_url or existing.job_url
        existing.description = description or existing.description
        existing.skills = skills or existing.skills
        existing.save()
        return existing, False, warnings

    listing = JobListing.objects.create(
        company=company,
        role=role,
        location=location,
        role_type=role_type,
        work_arrangement=work_arrangement,
        opened_at=opened_at,
        closing_at=closing_at,
        job_url=job_url,
        description=description,
        skills=skills,
    )
    return listing, True, warnings


def import_listings(rows):
    """Best-effort over a list of rows — one bad row doesn't sink the batch."""
    results = []
    for index, row in enumerate(rows):
        # Each row gets its own transaction: without one, a database error
        # here would poison the surrounding transaction and take the whole
        # batch (and the response) down with it.
        try:
            with transaction.atomic():
                listing, created, warnings = import_listing(row)
            results.append(
                {
                    "index": index,
                    "ok": True,
                    "id": listing.id,
                    "created": created,
                    "role": listing.role.name,
                    "company": listing.company.name,
                    "warnings": warnings,
                }
            )
        except ValueError as exc:
            results.append({"index": index, "ok": False, "error": str(exc)})
        except (DatabaseError, ValidationError) as exc:
            # Anything the database or a field validator refused. Reported as
            # a failed row rather than a 500, so the user sees which listing
            # broke and why instead of a blank "something went wrong".
            results.append(
                {
                    "index": index,
                    "ok": False,
                    "error": f"Couldn't save this listing — {exc}".strip(),
                }
            )
    return results
