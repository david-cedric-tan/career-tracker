"""The admin console API — superuser only.

Django's own `is_superuser` is the gate, not `Profile.is_developer`: the
developer flag reads everyone's tickets and nothing else, while this can move
the whole database. A superuser is an operator, not a tracker user — the SPA
routes them to the console instead of the app.
"""

import os
import platform
import subprocess
import sys
import time
from pathlib import Path

import django
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import (
    PasswordResetRequest,
    Profile,
    RefinementEventLog,
    RefinementMessage,
    RefinementNote,
)
from accounts.purge import purge_user_data
from applications.models import Application, Company, LibraryDocument, Resume
from backup.views import IsSuperUser
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import Person
from todos.models import Todo

from .migration import (
    SECTION_KEYS,
    apply_migration,
    build_migration,
    describe_sections,
    preview_migration,
    read_migration,
)

User = get_user_model()
BOOTED_AT = time.time()
MAX_MIGRATION_BYTES = 2 * 1024 * 1024 * 1024
IMPORT_CONFIRMATION = "REPLACE"

console_api = [IsAuthenticated, IsSuperUser]


def _git_revision():
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=settings.BASE_DIR,
            capture_output=True,
            text=True,
            timeout=2,
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _media_stats():
    root = Path(settings.MEDIA_ROOT)
    count = 0
    size = 0
    if root.exists():
        for path in root.rglob("*"):
            if path.is_file():
                count += 1
                size += path.stat().st_size
    return {"path": str(root), "files": count, "bytes": size}


def _db_stats():
    db = settings.DATABASES["default"]
    info = {"engine": db["ENGINE"].rsplit(".", 1)[-1], "name": str(db.get("NAME", ""))}
    if info["engine"] == "sqlite3":
        path = Path(str(db["NAME"]))
        info["bytes"] = path.stat().st_size if path.exists() else 0
    else:
        info["host"] = db.get("HOST", "")
        info["bytes"] = None
    info["vendor"] = connection.vendor
    return info


def _account_counts(user):
    return {
        "applications": Application.objects.filter(user=user).count(),
        "people": Person.objects.filter(user=user).count(),
        "catchups": Catchup.objects.filter(user=user).count(),
        "todos": Todo.objects.filter(user=user).count(),
        "events": CalendarEvent.objects.filter(user=user).count(),
        "resumes": Resume.objects.filter(user=user).count(),
        "documents": LibraryDocument.objects.filter(user=user).count(),
        "tickets": RefinementNote.objects.filter(user=user).count(),
    }


def _pending_reset_at(user):
    """When this account asked for a password reset, or None if it hasn't."""
    pending = (
        PasswordResetRequest.objects.filter(user=user, resolved_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    return pending.created_at.isoformat() if pending else None


def _account_row(user):
    profile = Profile.for_user(user)
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "is_active": user.is_active,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "is_developer": profile.is_developer,
        "onboarding_completed": profile.onboarding_completed,
        "date_joined": user.date_joined.isoformat() if user.date_joined else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "counts": _account_counts(user),
        "password_reset_requested_at": _pending_reset_at(user),
    }


@api_view(["GET"])
@permission_classes(console_api)
def overview(request):
    """One screen of system facts: versions, storage, settings, totals."""
    users = User.objects.all()
    return Response(
        {
            "server_time": timezone.now().isoformat(),
            "uptime_seconds": int(time.time() - BOOTED_AT),
            "revision": _git_revision(),
            "python": sys.version.split()[0],
            "django": django.get_version(),
            "platform": platform.platform(),
            "hostname": platform.node(),
            "pid": os.getpid(),
            "database": _db_stats(),
            "media": _media_stats(),
            "settings": {
                "DEBUG": settings.DEBUG,
                "ALLOWED_HOSTS": list(settings.ALLOWED_HOSTS),
                "CORS_ALLOWED_ORIGINS": list(getattr(settings, "CORS_ALLOWED_ORIGINS", [])),
                "TIME_ZONE": settings.TIME_ZONE,
                "LANGUAGE_CODE": settings.LANGUAGE_CODE,
                "MEDIA_URL": settings.MEDIA_URL,
                "BASE_DIR": str(settings.BASE_DIR),
            },
            "totals": {
                "accounts": users.count(),
                "active_accounts": users.filter(is_active=True).count(),
                "superusers": users.filter(is_superuser=True).count(),
                "developers": Profile.objects.filter(is_developer=True).count(),
                "companies": Company.objects.count(),
                "applications": Application.objects.count(),
                "people": Person.objects.count(),
                "todos": Todo.objects.count(),
                "events": CalendarEvent.objects.count(),
                "tickets": RefinementNote.objects.count(),
                "open_tickets": RefinementNote.objects.exclude(status="done").count(),
                "password_resets": PasswordResetRequest.objects.filter(
                    resolved_at__isnull=True
                ).count(),
            },
            "sections": describe_sections(),
        }
    )


@api_view(["GET", "POST"])
@permission_classes(console_api)
def accounts(request):
    """GET every account with its flags and row counts; POST creates one."""
    if request.method == "GET":
        return Response([_account_row(u) for u in User.objects.order_by("id")])

    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    if not username or len(password) < 8:
        return Response(
            {"detail": "A username and a password of at least 8 characters are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username=username).exists():
        return Response({"detail": "That username is taken."}, status=status.HTTP_400_BAD_REQUEST)
    user = User.objects.create_user(
        username=username,
        password=password,
        email=(request.data.get("email") or "").strip(),
        first_name=(request.data.get("first_name") or "").strip(),
        last_name=(request.data.get("last_name") or "").strip(),
    )
    if request.data.get("is_superuser"):
        user.is_superuser = True
        user.is_staff = True
        user.save(update_fields=["is_superuser", "is_staff"])
    profile = Profile.for_user(user)
    if request.data.get("is_developer"):
        profile.is_developer = True
        profile.save(update_fields=["is_developer"])
    return Response(_account_row(user), status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes(console_api)
def account_detail(request, pk):
    """PATCH flags (active / developer / staff / superuser) or DELETE the
    account and everything it owns. Neither can be turned on yourself."""
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        if user.pk == request.user.pk:
            return Response(
                {"detail": "You can't delete the account you're signed in as."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request.data.get("confirm") != user.username:
            return Response(
                {"detail": f"Type the username ({user.username}) to confirm."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        purge_user_data(user)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    profile = Profile.for_user(user)
    changed = []
    for flag in ("is_active", "is_staff", "is_superuser"):
        if flag in request.data:
            value = bool(request.data[flag])
            if user.pk == request.user.pk and not value:
                return Response(
                    {"detail": f"You can't remove {flag} from your own account."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            setattr(user, flag, value)
            changed.append(flag)
    if changed:
        user.save(update_fields=changed)
    if "is_developer" in request.data:
        profile.is_developer = bool(request.data["is_developer"])
        profile.save(update_fields=["is_developer"])
    for field in ("first_name", "last_name", "email"):
        if field in request.data:
            setattr(user, field, (request.data[field] or "").strip())
            user.save(update_fields=[field])
    password = request.data.get("password")
    if password:
        if len(password) < 8:
            return Response(
                {"detail": "Passwords need at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(password)
        user.save(update_fields=["password"])
        # A new password invalidates the old token so a lost device is out.
        from rest_framework.authtoken.models import Token

        if user.pk != request.user.pk:
            Token.objects.filter(user=user).delete()
        # Setting a password is how a "forgot my password" request gets
        # answered — the queue entry clears itself rather than lingering.
        PasswordResetRequest.objects.filter(user=user, resolved_at__isnull=True).update(
            resolved_at=timezone.now(), resolved_by=request.user
        )
    return Response(_account_row(user))


@api_view(["GET"])
@permission_classes(console_api)
def password_resets(request):
    """Open "forgot my password" requests, oldest first — the operator's
    queue. An entry leaves it when a password is set on that account."""
    rows = (
        PasswordResetRequest.objects.filter(resolved_at__isnull=True)
        .select_related("user")
        .order_by("created_at")
    )
    return Response(
        [
            {
                "id": row.id,
                "user_id": row.user_id,
                "username": row.user.username,
                "email": row.user.email,
                "message": row.message,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    )


@api_view(["GET"])
@permission_classes(console_api)
def migration_sections(request):
    """The toggle list, with live counts — optionally for chosen accounts."""
    user_ids = _user_ids(request.query_params.get("users"))
    return Response({"sections": describe_sections(user_ids), "users": user_ids})


def _user_ids(raw):
    if not raw or raw == "all":
        return None
    ids = []
    for part in str(raw).split(","):
        part = part.strip()
        if part.isdigit():
            ids.append(int(part))
    return ids


@api_view(["GET"])
@permission_classes(console_api)
def migration_export(request):
    """`?sections=a,b&users=1,2&media=1` → the zip."""
    raw_sections = request.query_params.get("sections")
    sections = [s for s in raw_sections.split(",") if s] if raw_sections else None
    user_ids = _user_ids(request.query_params.get("users"))
    include_media = request.query_params.get("media", "1") not in {"0", "false", "no"}
    try:
        payload = build_migration(sections, user_ids, include_media)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    from django.http import HttpResponse

    stamp = timezone.now().strftime("%Y-%m-%d-%H%M")
    scope = "full" if not sections and user_ids is None else "partial"
    response = HttpResponse(payload, content_type="application/zip")
    response["Content-Disposition"] = (
        f'attachment; filename="career-tracker-migration-{scope}-{stamp}.zip"'
    )
    return response


@api_view(["POST"])
@permission_classes(console_api)
@parser_classes([MultiPartParser, FormParser])
def migration_import(request):
    """Upload a migration zip. `dry_run=1` previews; otherwise
    `confirm=REPLACE` is required and the dump's tables are replaced.

    The signed-in operator may be replaced too if the dump carries accounts
    — the response says so, and the SPA sends them back to sign in.
    """
    upload = request.FILES.get("file")
    if upload is None:
        return Response({"detail": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)
    if upload.size > MAX_MIGRATION_BYTES:
        return Response({"detail": "That archive is over 2GB."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        manifest, dump_bytes, media_names, zf = read_migration(upload)
        preview = preview_migration(manifest, dump_bytes, media_names)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    dry_run = str(request.data.get("dry_run", "")).lower() in {"1", "true", "yes"}
    if dry_run:
        return Response({"dry_run": True, **preview})

    if request.data.get("confirm") != IMPORT_CONFIRMATION:
        return Response(
            {"detail": f"Type {IMPORT_CONFIRMATION} to confirm — this replaces the tables in the archive."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    replaces_accounts = any(m == "auth.user" for m in preview["models"])
    try:
        result = apply_migration(zf, manifest, dump_bytes, media_names)
    except Exception as exc:  # noqa: BLE001 — surfaced to the operator verbatim
        return Response({"detail": f"Restore failed and was rolled back: {exc}"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(
        {
            "dry_run": False,
            **preview,
            **result,
            "signed_out": replaces_accounts,
        }
    )


def _message_row(message):
    return {
        "id": message.id,
        "author": message.user.username if message.user_id else None,
        "body": message.body,
        "image": message.image.url if message.image else None,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


def _event_row(event):
    return {
        "id": event.id,
        "event_type": event.event_type,
        "detail": event.detail,
        "actor": event.actor.username if event.actor_id else None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def _ticket_row(note, detail=False):
    row = {
        "id": note.id,
        "user": note.user.username,
        "user_id": note.user_id,
        "kind": note.kind,
        "status": note.status,
        "page": note.page,
        "screens": list(note.screens or []),
        "body": note.body,
        "resolution": note.resolution,
        "resolved_by": note.resolved_by.username if note.resolved_by_id else None,
        "resolved_at": note.resolved_at.isoformat() if note.resolved_at else None,
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "updated_at": note.updated_at.isoformat() if note.updated_at else None,
        "message_count": note.messages.count(),
        "event_count": note.event_logs.count(),
    }
    if detail:
        row["messages"] = [_message_row(m) for m in note.messages.select_related("user").order_by("created_at")]
        row["events"] = [_event_row(e) for e in note.event_logs.select_related("actor").order_by("created_at")]
    return row


@api_view(["GET"])
@permission_classes(console_api)
def refinements(request):
    """Every account's tickets, newest first — the operator's audit view."""
    qs = RefinementNote.objects.select_related("user", "resolved_by").order_by("-created_at")
    status_filter = request.query_params.get("status")
    if status_filter:
        qs = qs.filter(status=status_filter)
    user_filter = request.query_params.get("user")
    if user_filter and user_filter.isdigit():
        qs = qs.filter(user_id=int(user_filter))
    return Response([_ticket_row(n) for n in qs])


@api_view(["GET"])
@permission_classes(console_api)
def refinement_detail(request, pk):
    try:
        note = RefinementNote.objects.select_related("user", "resolved_by").get(pk=pk)
    except RefinementNote.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    return Response(_ticket_row(note, detail=True))


@api_view(["GET"])
@permission_classes(console_api)
def activity(request):
    """The last N refinement events and messages across every account —
    a live tail for the console's footer."""
    limit = min(int(request.query_params.get("limit", 40) or 40), 200)
    events = [
        {**_event_row(e), "ticket": e.note_id, "user": e.note.user.username, "type": "event"}
        for e in RefinementEventLog.objects.select_related("actor", "note__user").order_by("-created_at")[:limit]
    ]
    messages = [
        {**_message_row(m), "ticket": m.note_id, "user": m.note.user.username, "type": "message"}
        for m in RefinementMessage.objects.select_related("user", "note__user").order_by("-created_at")[:limit]
    ]
    merged = sorted(events + messages, key=lambda r: r["created_at"] or "", reverse=True)[:limit]
    return Response(merged)


