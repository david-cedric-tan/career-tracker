"""The "Full Data + Resources" backup — data.json plus every file it
references, bundled into one .zip (FR-EXPORT-05).

Layered on top of the existing JSON archive rather than replacing it:
data.json inside the zip is byte-for-byte what `export_json` produces, so a
zip is still readable by anything that already understands the plain JSON
export. manifest.json is the only new thing — it says which file belongs to
which row, by natural key, so import can reattach files after the JSON
restore rebuilds the rows with fresh ids.
"""

import json
import zipfile
from io import BytesIO

from .archive import ARCHIVE_VERSION, build_archive, collect_media_manifest

DATA_ENTRY = "data.json"
MANIFEST_ENTRY = "manifest.json"


def build_zip_archive(user):
    """The full backup, as zip bytes."""
    archive = build_archive(user)
    media = collect_media_manifest(user)

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(DATA_ENTRY, json.dumps(archive, indent=2, ensure_ascii=False))

        manifest_rows = []
        for row, field_file in media:
            field_file.open("rb")
            try:
                zf.writestr(row["path"], field_file.read())
            finally:
                field_file.close()
            manifest_rows.append(row)

        zf.writestr(
            MANIFEST_ENTRY,
            json.dumps({"version": ARCHIVE_VERSION, "files": manifest_rows}, indent=2),
        )

    return buffer.getvalue()


def read_zip_archive(upload):
    """Parse an uploaded .zip back into `(archive_dict, manifest_rows, media_bytes)`.

    `media_bytes` maps each manifest row's `path` to its raw bytes, held in
    memory for the reattachment step that runs after the JSON restore.
    """
    from rest_framework import serializers

    try:
        zf = zipfile.ZipFile(upload)
    except zipfile.BadZipFile:
        raise serializers.ValidationError({"file": "That doesn’t look like a valid .zip archive."})

    names = set(zf.namelist())
    if DATA_ENTRY not in names:
        raise serializers.ValidationError(
            {"file": f"This zip has no {DATA_ENTRY} — it isn’t a Career Tracker backup."}
        )

    try:
        archive = json.loads(zf.read(DATA_ENTRY).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise serializers.ValidationError({"file": f"{DATA_ENTRY} inside this zip isn’t readable JSON."})

    manifest_rows = []
    media_bytes = {}
    if MANIFEST_ENTRY in names:
        try:
            manifest = json.loads(zf.read(MANIFEST_ENTRY).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise serializers.ValidationError(
                {"file": f"{MANIFEST_ENTRY} inside this zip isn’t readable JSON."}
            )
        manifest_rows = manifest.get("files", [])
        for row in manifest_rows:
            path = row.get("path")
            if path and path in names:
                media_bytes[path] = zf.read(path)

    return archive, manifest_rows, media_bytes
