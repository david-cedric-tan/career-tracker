"""Export and restore a user's account (FR-EXPORT-*)."""

import json
from datetime import date

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from .archive import ARCHIVE_VERSION, archive_counts, build_archive, collect_media_manifest
from .full_dump import build_full_backup
from .restore import reattach_media, restore, validate_archive
from .workbook import read_workbook
from .ziparchive import build_zip_archive, read_zip_archive

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
# Data + Resources bundles resumes, photos and logos, so it gets a lot more
# headroom than a data-only .json/.xlsx upload.
MAX_ZIP_ARCHIVE_BYTES = 200 * 1024 * 1024


def _filename(user, extension):
    return f"career-tracker-{user.username}-{date.today().isoformat()}.{extension}"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_json(request):
    """The canonical backup: lossless, and what `import` reads best."""
    archive = build_archive(request.user)
    response = HttpResponse(
        json.dumps(archive, indent=2, ensure_ascii=False),
        content_type="application/json",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_filename(request.user, "json")}"'
    )
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_xlsx(request):
    """The same archive as a workbook — readable in Excel, still importable."""
    # Imported lazily so a missing openpyxl degrades to a clear 500 on this one
    # endpoint rather than breaking app startup.
    from .workbook import write_workbook

    payload = write_workbook(build_archive(request.user))
    response = HttpResponse(
        payload,
        content_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_filename(request.user, "xlsx")}"'
    )
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_zip(request):
    """The full backup: data.json plus every resume/photo/logo it references."""
    payload = build_zip_archive(request.user)
    response = HttpResponse(payload, content_type="application/zip")
    response["Content-Disposition"] = (
        f'attachment; filename="{_filename(request.user, "zip")}"'
    )
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_summary(request):
    """What a backup would contain right now, for the Settings panel."""
    archive = build_archive(request.user)
    return Response(
        {
            "version": ARCHIVE_VERSION,
            "counts": archive_counts(archive),
            "file_count": len(collect_media_manifest(request.user)),
        }
    )


def _parse_upload(upload):
    """Returns `(archive_dict, manifest_rows, media_bytes)` — the latter two
    are empty for a data-only .json/.xlsx upload."""
    name = (upload.name or "").lower()
    if name.endswith(".zip"):
        archive, manifest_rows, media_bytes = read_zip_archive(upload)
        return archive, manifest_rows, media_bytes
    if name.endswith(".xlsx"):
        return read_workbook(upload), [], {}
    if name.endswith(".json"):
        try:
            return json.loads(upload.read().decode("utf-8")), [], {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            from rest_framework import serializers

            raise serializers.ValidationError({"file": "That file isn’t readable JSON."})

    from rest_framework import serializers

    raise serializers.ValidationError(
        {"file": "Upload a .json, .xlsx or .zip archive exported from this app."}
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def import_archive(request):
    """Restore from an archive.

    Destructive by design — this is disaster recovery, so it replaces the
    account's data rather than merging into it. The client must say so
    explicitly, and can ask for a dry run first to see what it would write.
    A .zip archive also carries files (resumes, photos, logos), reattached
    to the freshly-restored rows once the data itself is back.
    """
    upload = request.FILES.get("file")
    if upload is None:
        return Response({"file": ["No file uploaded."]}, status=status.HTTP_400_BAD_REQUEST)

    is_zip = (upload.name or "").lower().endswith(".zip")
    size_limit = MAX_ZIP_ARCHIVE_BYTES if is_zip else MAX_ARCHIVE_BYTES
    if upload.size > size_limit:
        return Response(
            {"file": [f"Archive is too large. The limit is {size_limit // 1024 // 1024}MB."]},
            status=status.HTTP_400_BAD_REQUEST,
        )

    archive, manifest_rows, media_bytes = _parse_upload(upload)
    validate_archive(archive)

    dry_run = str(request.data.get("dry_run", "")).lower() in {"1", "true", "yes"}
    if dry_run:
        return Response(
            {
                "dry_run": True,
                "from_username": archive.get("username", ""),
                "counts": archive_counts(archive),
                "file_count": len(manifest_rows),
            }
        )

    if request.data.get("mode") != "replace":
        return Response(
            {
                "mode": [
                    "Importing replaces everything in this account. "
                    "Send mode=replace to confirm."
                ]
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    counts, refs = restore(request.user, archive)
    files_attached = 0
    if manifest_rows:
        files_attached = reattach_media(request.user, refs, manifest_rows, media_bytes)
    return Response({"dry_run": False, "counts": counts, "files_attached": files_attached})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def import_from_ai(request):
    """Merge BYO-AI JSON into the account (does not wipe existing data).

    Body: the parsed object from `frontend/src/lib/importGuide.ts`, either as
    raw JSON or `{"payload": {...}}`.
    """
    from .ai_import import import_tracker_payload

    payload = request.data
    if isinstance(payload, dict) and "payload" in payload and isinstance(
        payload.get("payload"), dict
    ):
        payload = payload["payload"]

    try:
        summary = import_tracker_payload(request.user, payload)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    return Response(summary)


class IsSuperUser(BasePermission):
    """Real admin, not `Profile.is_developer` — that flag only grants reading
    the suggestion box (see accounts.models.Profile), which is a much smaller
    thing than everyone's data. This is Django's own `is_superuser`, set on
    whichever account should be trusted to move the whole app between
    machines (`createsuperuser`, or the admin site)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsSuperUser])
def export_full_backup(request):
    """Every table, every user, every uploaded file — for moving this whole
    app to another machine, not for one account's own backup (see
    `export_zip` for that). Restoring it is a management command
    (`restore_full_backup`), never a web endpoint — see `.full_dump` for why.
    """
    payload = build_full_backup()
    response = HttpResponse(payload, content_type="application/zip")
    response["Content-Disposition"] = (
        f'attachment; filename="career-tracker-full-backup-{date.today().isoformat()}.zip"'
    )
    return response

