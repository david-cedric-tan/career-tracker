"""Whole-database export for moving this app to another machine (admin only).

Unlike archive.py's per-user backup — one account's data, reshaped into a
portable, human-inspectable format — this is a raw snapshot of every table in
every app, plus the entire media/ tree, so a fresh install can become an exact
copy of this one. There is no reshaping: it's Django's own serializer format,
restored with `loaddata`.

Content types and permissions are left out and use natural keys for any FK
pointing at them (`use_natural_foreign_keys`) — a fresh install's `migrate`
already recreates those rows for the apps installed here, and their ids are
assigned in migration order, which won't line up with the source database's
ids. Natural keys route `ProfileAttachment.content_type` (and similar) to
whatever local row actually matches, instead of a raw id that might now point
at the wrong table. Sessions are left out too: they're per-browser login
state, not app data, and meaningless on another machine.
"""

import json
import zipfile
from datetime import datetime, timezone as dt_timezone
from io import BytesIO
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core import serializers as django_serializers

DUMP_FILENAME = "dump.json"
MANIFEST_FILENAME = "manifest.json"

EXCLUDED_MODELS = {
    "contenttypes.contenttype",
    "auth.permission",
    "sessions.session",
    "admin.logentry",
}


def _dumped_models():
    return [
        model
        for model in apps.get_models()
        if f"{model._meta.app_label}.{model._meta.model_name}" not in EXCLUDED_MODELS
    ]


def build_full_backup() -> bytes:
    """Every row in every table (bar the excluded few above), plus every
    uploaded file, as one zip: `dump.json` + a `media/` tree."""
    objects = []
    for model in _dumped_models():
        objects.extend(model._default_manager.all().iterator())

    dump = django_serializers.serialize(
        "json",
        objects,
        use_natural_foreign_keys=True,
        use_natural_primary_keys=True,
    )

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(DUMP_FILENAME, dump)

        media_root = Path(settings.MEDIA_ROOT)
        file_count = 0
        if media_root.exists():
            for path in sorted(media_root.rglob("*")):
                if path.is_file():
                    archive.write(path, arcname=f"media/{path.relative_to(media_root)}")
                    file_count += 1

        manifest = {
            "created_at": datetime.now(dt_timezone.utc).isoformat(),
            "object_count": len(objects),
            "file_count": file_count,
            "restore_with": "python manage.py restore_full_backup <this-file>",
        }
        archive.writestr(MANIFEST_FILENAME, json.dumps(manifest, indent=2))

    return buffer.getvalue()
