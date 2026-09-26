"""Selective whole-database migration for the admin console.

`backup.full_dump` snapshots *everything* for moving the app between machines.
This is the same snapshot with switches: which sections (groups of tables),
which accounts, and whether uploaded files ride along. A dump made with
sections turned off is still `loaddata`-compatible; restoring it here only
touches the tables it carries, so a "refinement logs only" export can be
loaded into a live database without disturbing anyone's applications.

Every model the app owns has to belong to exactly one section — the test
suite checks that, so a new table can't silently fall out of the migration.
"""

import json
import zipfile
from datetime import datetime, time, timedelta, timezone as dt_timezone
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.apps import apps
from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.core import management
from django.core.serializers.json import DjangoJSONEncoder
from django.core import serializers as django_serializers
from django.db import models, transaction
from django.db.models.deletion import ProtectedError
from django.utils.dateparse import parse_datetime

DUMP_FILENAME = "dump.json"
MANIFEST_FILENAME = "manifest.json"

# Framework tables that a fresh `migrate` recreates on its own — see
# backup.full_dump for why they're never dumped.
EXCLUDED_MODELS = {
    "contenttypes.contenttype",
    "auth.permission",
    "sessions.session",
    "admin.logentry",
    # OAuth tokens belong to this install's Google client; the new machine
    # reconnects from Settings instead.
    "google_tasks.googletasksconnection",
}

# Section key → (label, description, model labels). Order matters twice: it's
# the order the console lists them in, and the load order for `loaddata`
# (dependencies first — accounts before applications, catalogs before
# companies).
SECTIONS = [
    (
        "accounts",
        "Accounts & profiles",
        "Logins, auth tokens, profile details, appearance, experience, "
        "education, certifications, extra-curriculars, links and addresses.",
        [
            "auth.group",
            "auth.user",
            "authtoken.token",
            "accounts.profile",
            "accounts.experience",
            "accounts.experiencephoto",
            "accounts.education",
            "accounts.certification",
            "accounts.extracurricular",
            "accounts.profileattachment",
            "accounts.profilelink",
            "accounts.profileaddress",
        ],
    ),
    (
        "catalogs",
        "Reference catalogs",
        "Countries, states, cities, venues, industries, roles, pipeline "
        "stages and network tags — shared by every account.",
        [
            "applications.country",
            "applications.state",
            "applications.location",
            "applications.venue",
            "applications.industry",
            "applications.role",
            "applications.applicationstage",
            "network.relationshiptag",
            "network.metsourcetag",
        ],
    ),
    (
        "companies",
        "Companies & job listings",
        "The shared company directory (logos, regions, short names), "
        "per-user company notes and every job listing.",
        [
            "applications.company",
            "applications.companynote",
            "applications.joblisting",
        ],
    ),
    (
        "applications",
        "Applications & resumes",
        "Applications, their listing links, the full event history, "
        "resumes and application documents.",
        [
            "applications.resume",
            "applications.resumefile",
            "applications.application",
            "applications.applicationjoblisting",
            "applications.appseventlog",
            "applications.librarydocument",
        ],
    ),
    (
        "network",
        "Network",
        "Contacts, where they work, how to reach them, and who knows whom.",
        [
            "network.person",
            "network.personcompany",
            "network.contactmethod",
        ],
    ),
    ("catchups", "Catch-ups", "Every logged meeting and its follow-up.", ["catchups.catchup"]),
    ("todos", "Todos", "Tasks, their timing and manual order.", ["todos.todo"]),
    (
        "calendar",
        "Calendar events",
        "User-created events and their reminders.",
        ["events.calendarevent", "events.eventreminder"],
    ),
    (
        "refinements",
        "Refinement logs",
        "Tickets, their message threads, images and status history.",
        [
            "accounts.refinementnote",
            "accounts.refinementmessage",
            "accounts.refinementeventlog",
            "accounts.passwordresetrequest",
        ],
    ),
    (
        "onboarding",
        "Onboarding bookkeeping",
        "Which rows are demo data, so the sample-data checklist can clear them.",
        ["onboarding.sampledatarecord"],
    ),
]

SECTION_KEYS = [key for key, *_ in SECTIONS]

# Model label → ORM path from that row to the account that owns it. Absent
# means the table is shared reference data and never filtered by account.
# `None` means "owned, but reachable only in Python" (generic relations).
USER_PATHS = {
    "auth.user": "pk",
    "authtoken.token": "user",
    "accounts.profile": "user",
    "accounts.experience": "user",
    "accounts.experiencephoto": "experience__user",
    "accounts.education": "user",
    "accounts.certification": "user",
    "accounts.extracurricular": "user",
    "accounts.profileattachment": None,
    "accounts.profilelink": "user",
    "accounts.profileaddress": "user",
    "accounts.refinementnote": "user",
    "accounts.refinementmessage": "note__user",
    "accounts.refinementeventlog": "note__user",
    "accounts.passwordresetrequest": "user",
    "applications.companynote": "user",
    "applications.resume": "user",
    "applications.resumefile": "resume__user",
    "applications.application": "user",
    "applications.applicationjoblisting": "application__user",
    "applications.appseventlog": "application__user",
    "applications.librarydocument": "user",
    "network.person": "user",
    "network.personcompany": "person__user",
    "network.contactmethod": "person__user",
    "catchups.catchup": "user",
    "todos.todo": "user",
    "events.calendarevent": "user",
    "events.eventreminder": "event__user",
    "onboarding.sampledatarecord": "user",
}


def _label(model):
    return f"{model._meta.app_label}.{model._meta.model_name}"


def dumpable_models():
    """Every model a migration can carry, in registration order."""
    return [
        m
        for m in apps.get_models()
        # A proxy shares its table with the concrete model, which is dumped.
        if _label(m) not in EXCLUDED_MODELS and not m._meta.proxy
    ]


def section_models():
    """Section key → list of model classes, in load order."""
    by_label = {_label(m): m for m in dumpable_models()}
    return {
        key: [by_label[label] for label in labels if label in by_label]
        for key, _, _, labels in SECTIONS
    }


def _rows_for(model, user_ids):
    """The rows of `model` to dump — all of them, or just the chosen accounts'."""
    qs = model._default_manager.all()
    if user_ids is None:
        return list(qs.iterator())
    label = _label(model)
    if label not in USER_PATHS:
        return list(qs.iterator())  # shared reference data
    path = USER_PATHS[label]
    if path is None:
        # Generic attachments: keep the ones whose owner section belongs to
        # a chosen account.
        kept = []
        for row in qs.select_related("content_type").iterator():
            owner = row.owner
            if owner is not None and getattr(owner, "user_id", None) in user_ids:
                kept.append(row)
        return kept
    return list(qs.filter(**{f"{path}__in": user_ids}).iterator())


def _file_fields(model):
    return [f for f in model._meta.get_fields() if isinstance(f, models.FileField)]


def describe_sections(user_ids=None):
    """What each section holds right now — the console's toggle list."""
    models_by_section = section_models()
    out = []
    for key, label, description, _ in SECTIONS:
        tables = []
        total = 0
        files = 0
        for model in models_by_section[key]:
            rows = _rows_for(model, user_ids)
            count = len(rows)
            total += count
            for field in _file_fields(model):
                files += sum(1 for row in rows if getattr(row, field.name))
            tables.append(
                {
                    "model": _label(model),
                    "name": str(model._meta.verbose_name_plural),
                    "rows": count,
                }
            )
        out.append(
            {
                "key": key,
                "label": label,
                "description": description,
                "rows": total,
                "files": files,
                "tables": tables,
            }
        )
    return out


class PreciseJSONEncoder(DjangoJSONEncoder):
    """DjangoJSONEncoder, minus its rounding of times to milliseconds.

    That rounding is lossy in a way that matters here: rows kept apart by a
    unique constraint on a timestamp — `uniq_event_per_app_time` on the
    application history, where older versions spaced same-moment rows by
    microseconds — come out of the dump with identical stamps, and the
    restore then fails on the very constraint the source satisfied.
    `loaddata` reads full-precision ISO strings back without complaint.
    """

    def default(self, o):
        if isinstance(o, datetime):
            text = o.isoformat()
            return text[:-6] + "Z" if text.endswith("+00:00") else text
        if isinstance(o, time):
            return o.isoformat()
        return super().default(o)


def _unique_field_sets(model):
    """Every set of field names the database holds unique for `model`."""
    sets = [list(fields) for fields in model._meta.unique_together]
    for constraint in model._meta.constraints:
        if (
            isinstance(constraint, models.UniqueConstraint)
            and constraint.fields
            and constraint.condition is None
        ):
            sets.append(list(constraint.fields))
    return sets


def _instant(value):
    return parse_datetime(value) if isinstance(value, str) else None


def repair_dump(dump_bytes):
    """Undo the millisecond rounding in dumps made before PreciseJSONEncoder.

    For each unique constraint that includes exactly one datetime field,
    rows whose values now clash are moved apart by a millisecond at a time,
    in primary-key (creation) order, onto the first stamp nobody else holds.
    Returns `(dump_bytes, rows_repaired)`; the bytes are untouched when
    nothing clashed.
    """
    rows = json.loads(dump_bytes.decode("utf-8"))
    if not isinstance(rows, list):
        return dump_bytes, 0
    by_label = {_label(m): m for m in apps.get_models()}
    grouped = {}
    for row in rows:
        if isinstance(row, dict) and row.get("model") in by_label:
            grouped.setdefault(row["model"], []).append(row)

    repaired = 0
    for label, model_rows in grouped.items():
        model = by_label[label]
        for field_names in _unique_field_sets(model):
            try:
                fields = [model._meta.get_field(name) for name in field_names]
            except Exception:  # noqa: BLE001 — a constraint on a renamed field
                continue
            stamps = [f.name for f in fields if isinstance(f, models.DateTimeField)]
            if len(stamps) != 1:
                continue
            stamp = stamps[0]

            def key(row, moment=None):
                # Stamps compared as instants, not strings: an old dump's
                # "…00.001Z" and a repaired "…00.001000Z" are the same moment.
                values = row.get("fields", {})
                return tuple(
                    (moment if moment is not None else _instant(values.get(name)))
                    if name == stamp
                    # Natural foreign keys arrive as lists; make them hashable.
                    else (
                        None
                        if values.get(name) is None
                        else json.dumps(values.get(name), sort_keys=True)
                    )
                    for name in field_names
                )

            candidates = [r for r in model_rows if None not in key(r)]
            taken = {key(r) for r in candidates}
            kept = set()
            candidates.sort(
                key=lambda r: (0, r["pk"], "")
                if isinstance(r.get("pk"), int)
                else (1, 0, str(r.get("pk")))
            )
            for row in candidates:
                current = key(row)
                if current not in kept:
                    kept.add(current)
                    continue
                moment = _instant(row["fields"][stamp])
                while True:
                    moment += timedelta(milliseconds=1)
                    if key(row, moment) not in taken:
                        break
                row["fields"][stamp] = PreciseJSONEncoder().default(moment)
                taken.add(key(row, moment))
                kept.add(key(row, moment))
                repaired += 1

    if not repaired:
        return dump_bytes, 0
    return json.dumps(rows).encode("utf-8"), repaired


def build_migration(sections=None, user_ids=None, include_media=True):
    """Zip bytes: dump.json (+ media/ tree) + manifest.json.

    `sections` — keys from SECTIONS, default all. `user_ids` — restrict
    user-owned rows to these accounts (shared catalogs always come whole).
    `include_media` — bundle the files those rows reference.
    """
    chosen = list(sections) if sections else SECTION_KEYS
    unknown = [key for key in chosen if key not in SECTION_KEYS]
    if unknown:
        raise ValueError(f"Unknown section(s): {', '.join(unknown)}")
    # Load order is SECTIONS order regardless of how the request listed them.
    chosen = [key for key in SECTION_KEYS if key in chosen]
    user_ids = set(user_ids) if user_ids is not None else None

    models_by_section = section_models()
    objects = []
    model_labels = []
    media_paths = set()
    for key in chosen:
        for model in models_by_section[key]:
            rows = _rows_for(model, user_ids)
            objects.extend(rows)
            model_labels.append(_label(model))
            if include_media:
                for field in _file_fields(model):
                    for row in rows:
                        value = getattr(row, field.name)
                        if value:
                            media_paths.add(value.name)

    dump = django_serializers.serialize(
        "json",
        objects,
        use_natural_foreign_keys=True,
        use_natural_primary_keys=True,
        cls=PreciseJSONEncoder,
    )

    buffer = BytesIO()
    media_root = Path(settings.MEDIA_ROOT)
    file_count = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(DUMP_FILENAME, dump)
        for name in sorted(media_paths):
            path = media_root / name
            if path.is_file():
                archive.write(path, arcname=f"media/{name}")
                file_count += 1
        manifest = {
            "created_at": datetime.now(dt_timezone.utc).isoformat(),
            "kind": "career-tracker-migration",
            "sections": chosen,
            "models": model_labels,
            "users": sorted(user_ids) if user_ids is not None else "all",
            "object_count": len(objects),
            "file_count": file_count,
            "include_media": include_media,
            "restore_with": "Admin console → Data migration → Import, or "
            "python manage.py restore_full_backup <this-file>",
        }
        archive.writestr(MANIFEST_FILENAME, json.dumps(manifest, indent=2))
    return buffer.getvalue()


def read_migration(upload):
    """Parse an uploaded zip into `(manifest, dump_bytes, media_names, zipfile)`.

    Older "download everything" zips have a manifest without `models`; they
    are treated as a full dump of every table.
    """
    try:
        zf = zipfile.ZipFile(upload)
    except zipfile.BadZipFile:
        raise ValueError("That isn't a valid .zip archive.")
    names = set(zf.namelist())
    if DUMP_FILENAME not in names:
        raise ValueError(f"This zip has no {DUMP_FILENAME} — it isn't a migration export.")
    manifest = {}
    if MANIFEST_FILENAME in names:
        try:
            manifest = json.loads(zf.read(MANIFEST_FILENAME).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            manifest = {}
    dump_bytes = zf.read(DUMP_FILENAME)
    media_names = sorted(n for n in names if n.startswith("media/") and not n.endswith("/"))
    return manifest, dump_bytes, media_names, zf


def preview_migration(manifest, dump_bytes, media_names):
    """Counts per model in the dump — shown before anything is written."""
    try:
        rows = json.loads(dump_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError(f"{DUMP_FILENAME} inside this zip isn't readable JSON.")
    if not isinstance(rows, list):
        raise ValueError(f"{DUMP_FILENAME} isn't a Django fixture.")
    counts = {}
    for row in rows:
        model = row.get("model") if isinstance(row, dict) else None
        if model:
            counts[model] = counts.get(model, 0) + 1
    models = manifest.get("models") or sorted(counts)
    return {
        "created_at": manifest.get("created_at"),
        "sections": manifest.get("sections") or SECTION_KEYS,
        "users": manifest.get("users", "all"),
        "models": models,
        "counts": counts,
        "object_count": len(rows),
        "file_count": len(media_names),
    }


def _delete_all(model_classes):
    """Empty every table in `model_classes`, whatever order their PROTECT
    foreign keys demand — retried until nothing is left or nothing moves."""
    pending = list(model_classes)
    while pending:
        progressed = False
        for model in list(pending):
            try:
                model._base_manager.all().delete()
            except ProtectedError:
                continue
            pending.remove(model)
            progressed = True
        if not progressed:
            raise RuntimeError(
                "Could not clear " + ", ".join(_label(m) for m in pending)
                + " — a table outside this migration still points at them."
            )


def apply_migration(zf, manifest, dump_bytes, media_names):
    """Replace the tables the dump carries (and only those) with its rows.

    Runs `loaddata` inside one transaction so a bad fixture leaves the
    database as it was. Media is copied in afterwards, overwriting files of
    the same name and leaving everything else in place — a partial export
    shouldn't take other accounts' photos with it.
    """
    by_label = {_label(m): m for m in dumpable_models()}
    labels = manifest.get("models")
    if not labels:
        # A full "download everything" zip: every table.
        labels = list(by_label)
    targets = [by_label[label] for label in labels if label in by_label]

    dump_bytes, repaired = repair_dump(dump_bytes)
    with TemporaryDirectory() as tmp:
        dump_file = Path(tmp) / DUMP_FILENAME
        dump_file.write_bytes(dump_bytes)
        with transaction.atomic():
            _delete_all(targets)
            management.call_command("loaddata", str(dump_file), verbosity=0)

        media_root = Path(settings.MEDIA_ROOT)
        copied = 0
        for name in media_names:
            relative = name[len("media/"):]
            # Never let a crafted entry escape MEDIA_ROOT.
            destination = (media_root / relative).resolve()
            if media_root.resolve() not in destination.parents:
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, open(destination, "wb") as dst:
                dst.write(src.read())
            copied += 1

    # ContentType ids are per-database; anything cached from before the
    # reload could now point at the wrong table.
    ContentType.objects.clear_cache()
    return {
        "models": [_label(m) for m in targets],
        "files_copied": copied,
        "timestamps_repaired": repaired,
    }
