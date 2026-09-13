import json
import os
import secrets
import time

from django.contrib.auth import login, logout
from django.contrib.contenttypes.models import ContentType
from django.db.models import Max
from django.utils import timezone
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from config.attachments import classify_and_validate
from config.images import (
    GALLERY_SIZE,
    WALLPAPER_SIZE,
    contain_thumbnail,
    square_thumbnail,
)

from .purge import purge_user_data
from .models import (
    Certification,
    Education,
    Experience,
    ExperiencePhoto,
    ExtraCurricular,
    Profile,
    ProfileAddress,
    ProfileAttachment,
    ProfileLink,
    REFINEMENT_DEV_STATUSES,
    RefinementEventType,
    RefinementNote,
    RefinementStatus,
    TICKET_SCREENS,
    log_refinement_event,
)
from .serializers import (
    AvatarSerializer,
    CertificationSerializer,
    EducationSerializer,
    ExperiencePhotoUploadSerializer,
    ExperienceSerializer,
    ExtraCurricularSerializer,
    LoginSerializer,
    PinnedPhotoSerializer,
    ProfileAddressSerializer,
    ProfileAttachmentUploadSerializer,
    ProfileLinkSerializer,
    RefinementMessageSerializer,
    RefinementNoteSerializer,
    SectionIconSerializer,
    RegisterSerializer,
    UserSerializer,
    WallpaperSerializer,
)


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — create user + return auth token."""

    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                "token": token.key,
                "user": UserSerializer(user, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """POST /api/auth/login/ — authenticate and return auth token."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        # Optional: also establish a session for browsable API / SessionAuthentication
        login(request, user)
        return Response(
            {
                "token": token.key,
                "user": UserSerializer(user, context={"request": request}).data,
            }
        )


class LogoutView(APIView):
    """POST /api/auth/logout/ — delete token + clear session."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/auth/me/ — current user profile."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


def _serialize_current_user(request):
    """Re-read the user first: `request.user` caches the reverse `profile`
    relation, so serializing it directly would echo pre-upload data."""
    user = request.user
    user.refresh_from_db()
    return UserSerializer(user, context={"request": request}).data


class AvatarView(APIView):
    """POST/DELETE /api/auth/me/avatar/ — set or clear the profile picture."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = AvatarSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        profile = Profile.for_user(request.user)
        profile.avatar.delete(save=False)  # don't orphan the previous file
        profile.avatar = square_thumbnail(
            serializer.validated_data["avatar"], name=f"user-{request.user.id}"
        )
        profile.save()

        return Response(_serialize_current_user(request))

    def delete(self, request):
        profile = Profile.for_user(request.user)
        profile.avatar.delete(save=True)
        return Response(_serialize_current_user(request))


class WallpaperView(APIView):
    """POST/DELETE /api/auth/me/wallpaper/ — a user's own Intern-mode photo."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = WallpaperSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        profile = Profile.for_user(request.user)
        profile.custom_wallpaper.delete(save=False)  # don't orphan the previous file
        # Preserve the aspect ratio rather than crop — the frontend applies
        # its own `background-size: cover`, so cropping server-side would only
        # throw away detail the client could have used.
        profile.custom_wallpaper = contain_thumbnail(
            serializer.validated_data["wallpaper"],
            size=WALLPAPER_SIZE,
            name=f"wallpaper-{request.user.id}",
        )
        profile.save()

        return Response(_serialize_current_user(request))

    def delete(self, request):
        profile = Profile.for_user(request.user)
        profile.custom_wallpaper.delete(save=True)
        return Response(_serialize_current_user(request))


class PinnedPhotoView(APIView):
    """POST/DELETE /api/auth/me/pinned-photo/ — dashboard desk photo."""

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = PinnedPhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        profile = Profile.for_user(request.user)
        profile.pinned_photo.delete(save=False)
        profile.pinned_photo = contain_thumbnail(
            serializer.validated_data["photo"],
            size=GALLERY_SIZE,
            name=f"pinned-{request.user.id}",
        )
        profile.pinned_photo_caption = serializer.validated_data.get("caption", "").strip()
        profile.save()

        return Response(_serialize_current_user(request))

    def delete(self, request):
        profile = Profile.for_user(request.user)
        profile.pinned_photo.delete(save=False)
        profile.pinned_photo_caption = ""
        profile.save()
        return Response(_serialize_current_user(request))


class ExperienceViewSet(viewsets.ModelViewSet):
    """The user's own work history, each entry with a photo gallery."""

    serializer_class = ExperienceSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Experience.objects.none()

    def get_queryset(self):
        return (
            Experience.objects.filter(user=self.request.user)
            .select_related("company")
            .prefetch_related("photos")
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="photos",
    )
    def add_photo(self, request, pk=None):
        """POST /api/experiences/{id}/photos/ — append one image to the gallery."""
        experience = self.get_object()
        serializer = ExperiencePhotoUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ExperiencePhoto.objects.create(
            experience=experience,
            image=contain_thumbnail(
                serializer.validated_data["image"],
                size=GALLERY_SIZE,
                name=f"experience-{experience.id}",
            ),
            caption=serializer.validated_data.get("caption", "").strip(),
        )

        experience.refresh_from_db()
        return Response(
            self.get_serializer(experience).data, status=status.HTTP_201_CREATED
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"photos/(?P<photo_id>\d+)",
    )
    def remove_photo(self, request, pk=None, photo_id=None):
        experience = self.get_object()
        # Scoped through the experience, so a photo id from someone else's
        # gallery can't be deleted by guessing it.
        photo = experience.photos.filter(pk=photo_id).first()
        if photo is None:
            return Response(
                {"detail": "No such photo in this gallery."},
                status=status.HTTP_404_NOT_FOUND,
            )
        photo.delete()  # post_delete removes the file too

        experience.refresh_from_db()
        return Response(self.get_serializer(experience).data)


class SectionIconMixin:
    """Shared `icon/` actions — one identifying image per row.

    Separate from `AttachmentSectionMixin`, which manages a *gallery*: this is
    the single mark that represents the entry in a list, so it replaces rather
    than appends, and the previous file is deleted instead of orphaned.
    """

    icon_name_prefix = "icon"

    @action(
        detail=True,
        methods=["post", "delete"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="icon",
    )
    def icon(self, request, pk=None):
        instance = self.get_object()

        if request.method == "DELETE":
            instance.icon.delete(save=True)
            return Response(self.get_serializer(instance).data)

        serializer = SectionIconSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        instance.icon.delete(save=False)  # don't orphan the previous file
        instance.icon = contain_thumbnail(
            serializer.validated_data["icon"],
            size=GALLERY_SIZE,
            name=f"{self.icon_name_prefix}-{instance.id}",
        )
        instance.save(update_fields=["icon"])

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)


class AttachmentSectionMixin:
    """Shared `attachments/` actions for a profile section (FR-PROF-13).

    Any ViewSet mixing this in gets POST to add a file (image or document,
    classified automatically) and DELETE to remove one — scoped through the
    section instance, so an attachment id from someone else's row can't be
    reached by guessing it.
    """

    attachment_name_prefix = "attachment"

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="attachments",
    )
    def add_attachment(self, request, pk=None):
        instance = self.get_object()
        serializer = ProfileAttachmentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        upload = serializer.validated_data["file"]
        kind = classify_and_validate(upload)
        original_name = upload.name

        if kind == "image":
            stored = contain_thumbnail(
                upload, size=GALLERY_SIZE, name=f"{self.attachment_name_prefix}-{instance.id}"
            )
        else:
            extension = os.path.splitext(upload.name)[1].lower()
            upload.name = (
                f"{self.attachment_name_prefix}-{instance.id}-{secrets.token_hex(4)}{extension}"
            )
            stored = upload

        ProfileAttachment.objects.create(
            content_type=ContentType.objects.get_for_model(instance),
            object_id=instance.id,
            file=stored,
            original_name=original_name,
            kind=kind,
            caption=serializer.validated_data.get("caption", "").strip(),
        )

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"attachments/(?P<attachment_id>\d+)",
    )
    def remove_attachment(self, request, pk=None, attachment_id=None):
        instance = self.get_object()
        attachment = instance.attachments.filter(pk=attachment_id).first()
        if attachment is None:
            return Response(
                {"detail": "No such attachment on this record."},
                status=status.HTTP_404_NOT_FOUND,
            )
        attachment.delete()  # post_delete removes the file too

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)


class EducationViewSet(SectionIconMixin, AttachmentSectionMixin, viewsets.ModelViewSet):
    serializer_class = EducationSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Education.objects.none()
    attachment_name_prefix = "education"

    def get_queryset(self):
        return Education.objects.filter(user=self.request.user).prefetch_related(
            "attachments"
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class CertificationViewSet(SectionIconMixin, AttachmentSectionMixin, viewsets.ModelViewSet):
    serializer_class = CertificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Certification.objects.none()
    attachment_name_prefix = "certification"

    def get_queryset(self):
        return Certification.objects.filter(user=self.request.user).prefetch_related(
            "attachments"
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ExtraCurricularViewSet(SectionIconMixin, AttachmentSectionMixin, viewsets.ModelViewSet):
    serializer_class = ExtraCurricularSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ExtraCurricular.objects.none()
    attachment_name_prefix = "extracurricular"

    def get_queryset(self):
        return ExtraCurricular.objects.filter(user=self.request.user).prefetch_related(
            "attachments"
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ProfileLinkViewSet(SectionIconMixin, viewsets.ModelViewSet):
    serializer_class = ProfileLinkSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ProfileLink.objects.none()

    def get_queryset(self):
        return ProfileLink.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        # New links go to the bottom, where the add form that made them sits.
        last = (
            ProfileLink.objects.filter(user=self.request.user)
            .aggregate(Max("position"))
            .get("position__max")
        )
        serializer.save(
            user=self.request.user, position=0 if last is None else last + 1
        )

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """POST {"ids": [...]} — the links in the order they should sit."""
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            return Response(
                {"ids": ["Send the link ids as a list, in their new order."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mine = set(
            ProfileLink.objects.filter(user=request.user, id__in=ids).values_list(
                "id", flat=True
            )
        )
        unknown = [i for i in ids if i not in mine]
        if unknown:
            return Response(
                {"ids": [f"{len(unknown)} of those aren't your links."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for index, link_id in enumerate(ids):
            ProfileLink.objects.filter(user=request.user, id=link_id).update(
                position=index
            )
        return Response({"ids": ids})


class RefinementNoteViewSet(viewsets.ModelViewSet):
    """The developer-mode log: refinements, complaints and bugs.

    Scoped to the requesting user, with one exception — an account flagged
    `Profile.is_developer` reads every account's notes, since it is the one that
    has to act on them. That widened read is the whole point of the flag, so
    everything that writes is checked separately below: the developer may reply
    to another person's note and nothing else. Editing or deleting someone
    else's complaint is exactly the move that would make people stop filing
    them.
    """

    serializer_class = RefinementNoteSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = RefinementNote.objects.none()

    @property
    def is_developer(self):
        return Profile.for_user(self.request.user).is_developer

    def get_queryset(self):
        qs = RefinementNote.objects.select_related("user", "resolved_by").prefetch_related(
            "event_logs__actor",
            "messages",
        )
        # `scope=mine` lets the developer look at their own log without the
        # rest of the backlog on top of it.
        scope = self.request.query_params.get("scope", "all")
        if self.is_developer and scope == "all":
            qs = qs.all()
        else:
            qs = qs.filter(user=self.request.user)

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        note = serializer.save(user=self.request.user)
        log_refinement_event(
            note,
            RefinementEventType.RAISED,
            actor=self.request.user,
            at=note.created_at,
        )

    def _require_own(self, note):
        if note.user_id != self.request.user.id:
            raise PermissionDenied("You can only change your own notes.")

    def perform_update(self, serializer):
        note = serializer.instance
        self._require_own(note)
        # Reopening is the one edit an answered ticket still allows — that's how
        # you say "this isn't actually fixed" without rewriting the history of
        # what was asked and answered.
        previous_status = note.status
        previous_body = note.body
        previous_screens = list(note.screens or [])
        reopening = serializer.validated_data.get("status") == RefinementStatus.OPEN
        # A ticket that's already open is editable again — even if an old
        # resolution string is still sitting on the row from before we cleared
        # it on reopen. Only a *done* answered ticket stays locked.
        if (
            note.is_locked
            and note.status != RefinementStatus.OPEN
            and not reopening
        ):
            raise PermissionDenied(
                "This one's been answered. Reopen it if it isn't actually fixed."
            )
        serializer.save()
        note.refresh_from_db()

        actor = self.request.user
        cleared_stale_fix = False
        if note.status == RefinementStatus.OPEN and (
            note.resolution or note.resolved_at or note.resolved_by_id
        ):
            # Keep the fix text in the history row; clear it on the note so the
            # ticket is editable again and the banner reads as open, not fixed.
            note.resolution = ""
            note.resolved_at = None
            note.resolved_by = None
            note.resolution_seen_at = None
            note.save(
                update_fields=[
                    "resolution",
                    "resolved_at",
                    "resolved_by",
                    "resolution_seen_at",
                    "updated_at",
                ]
            )
            cleared_stale_fix = True

        if previous_status != RefinementStatus.OPEN and note.status == RefinementStatus.OPEN:
            log_refinement_event(note, RefinementEventType.REOPENED, actor=actor)
        elif (
            previous_status != RefinementStatus.DONE
            and note.status == RefinementStatus.DONE
            and not note.resolution
        ):
            log_refinement_event(note, RefinementEventType.CLOSED, actor=actor)
        elif (
            not cleared_stale_fix
            and (
                note.body != previous_body
                or list(note.screens or []) != previous_screens
            )
        ):
            payload = {}
            if note.body != previous_body:
                # before/after so Activity can highlight what was added.
                payload["before"] = previous_body
                payload["after"] = note.body
            next_screens = list(note.screens or [])
            if next_screens != previous_screens:
                payload["screens_before"] = previous_screens
                payload["screens_after"] = next_screens
            detail = json.dumps(payload, ensure_ascii=False) if payload else ""
            log_refinement_event(
                note, RefinementEventType.EDITED, actor=actor, detail=detail
            )

    @action(detail=False, methods=["get"])
    def screens(self, request):
        """The tag vocabulary, so the client doesn't hard-code a second copy."""
        return Response(
            [{"value": value, "label": label} for value, label in TICKET_SCREENS]
        )

    def perform_destroy(self, instance):
        self._require_own(instance)
        instance.delete()

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        """POST /api/auth/refinements/{id}/resolve/ — reply that it's fixed.

        Clears `resolution_seen_at` so the reply lands as a notification for
        whoever raised it, including on a note that was resolved once before and
        has since been reopened.
        """
        note = self.get_object()
        if not self.is_developer and note.user_id != request.user.id:
            raise PermissionDenied("Only the developer can resolve this note.")

        message = (request.data.get("message") or "").strip()
        if not message:
            return Response(
                {"message": ["Say what you changed — that's the part they see."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note.status = RefinementStatus.DONE
        note.resolution = message
        note.resolved_at = timezone.now()
        note.resolved_by = request.user
        note.resolution_seen_at = None
        note.save(
            update_fields=[
                "status",
                "resolution",
                "resolved_at",
                "resolved_by",
                "resolution_seen_at",
                "updated_at",
            ]
        )
        log_refinement_event(
            note,
            RefinementEventType.FIXED,
            actor=request.user,
            detail=message,
            at=note.resolved_at,
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=note.pk)).data)

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        """POST /api/auth/refinements/{id}/set-status/ — park a ticket in a
        workflow status (Testing, Awaiting validation, or back to Open).

        Developer-only. Does not write a fix reply — that's still `resolve`.
        Answered (`done` + resolution) tickets must be reopened by the owner
        first; this only moves live work between open / testing / awaiting.
        """
        note = self.get_object()
        if not self.is_developer:
            raise PermissionDenied("Only the developer can update ticket status.")

        next_status = (request.data.get("status") or "").strip()
        if next_status not in REFINEMENT_DEV_STATUSES:
            return Response(
                {
                    "status": [
                        "Pick open, testing, or awaiting_validation — "
                        "use Mark fixed & reply to close a ticket."
                    ]
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if note.status == RefinementStatus.DONE and note.resolution:
            raise PermissionDenied(
                "This one's marked fixed. Ask the reporter to reopen it first."
            )

        if note.status == next_status:
            return Response(self.get_serializer(note).data)

        note.status = next_status
        note.save(update_fields=["status", "updated_at"])

        event_type = {
            RefinementStatus.TESTING: RefinementEventType.TESTING,
            RefinementStatus.AWAITING_VALIDATION: RefinementEventType.AWAITING_VALIDATION,
            RefinementStatus.OPEN: RefinementEventType.REOPENED,
        }[next_status]
        log_refinement_event(note, event_type, actor=request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=note.pk)).data)

    def _require_party(self, note):
        """Only the two people involved in a ticket can read or write its thread."""
        if note.user_id != self.request.user.id and not self.is_developer:
            raise PermissionDenied("That ticket isn't yours.")

    @action(
        detail=True,
        methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def messages(self, request, pk=None):
        """GET/POST /api/auth/refinements/{id}/messages/ — the ticket thread.

        A GET also marks the thread read for whichever side is asking: opening
        the conversation is exactly the gesture "I've seen this", and making it
        a separate call would leave the badge lit for anyone who read the
        messages and closed the window.

        Posting is allowed on an answered ticket. Locking editing is about not
        rewriting the original question; carrying on the conversation
        underneath it is fine, and is how "that didn't fix it" gets said.
        """
        note = self.get_object()
        self._require_party(note)

        if request.method == "POST":
            serializer = RefinementMessageSerializer(
                data=request.data, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            serializer.save(note=note, user=request.user)
            # Your own message shouldn't come back to you as unread.
            note.refresh_from_db()
            setattr(note, note.read_marker_for(request.user), timezone.now())
            note.save(update_fields=[note.read_marker_for(request.user)])
            return Response(serializer.data, status=status.HTTP_201_CREATED)

        # `after` + `wait` is how an open ticket stays live across two machines
        # without a websocket: the client holds a GET until a newer message
        # lands (or the wait expires), so a reply shows up in under a second
        # rather than on the next poll tick.
        after_raw = request.query_params.get("after")
        wait_raw = request.query_params.get("wait")
        after_id = None
        if after_raw not in (None, ""):
            try:
                after_id = int(after_raw)
            except (TypeError, ValueError):
                return Response(
                    {"after": ["Must be a message id."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        wait_secs = 0
        if wait_raw not in (None, ""):
            try:
                wait_secs = max(0, min(int(wait_raw), 25))
            except (TypeError, ValueError):
                return Response(
                    {"wait": ["Must be a number of seconds."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        def snapshot():
            qs = note.messages.select_related("user")
            if after_id is not None:
                qs = qs.filter(id__gt=after_id)
            return list(qs)

        rows = snapshot()
        if wait_secs and not rows:
            deadline = time.monotonic() + wait_secs
            while time.monotonic() < deadline and not rows:
                time.sleep(0.25)
                rows = snapshot()

        # Opening / watching the thread is the read gesture. An empty long-poll
        # timeout still counts — they were looking at it the whole time.
        marker = note.read_marker_for(request.user)
        setattr(note, marker, timezone.now())
        note.save(update_fields=[marker])

        # Full thread on a normal open; only the delta when catching up.
        if after_id is None:
            rows = list(note.messages.select_related("user"))

        return Response(
            RefinementMessageSerializer(
                rows,
                many=True,
                context=self.get_serializer_context(),
            ).data
        )

    @action(detail=False, methods=["post"])
    def acknowledge(self, request):
        """POST /api/auth/refinements/acknowledge/ — "I've read the replies".

        Only ever touches the caller's own notes, so one person clearing their
        notifications can't clear anyone else's.
        """
        updated = RefinementNote.objects.filter(
            user=request.user, resolution_seen_at__isnull=True
        ).exclude(resolution="").update(resolution_seen_at=timezone.now())
        return Response({"acknowledged": updated})


class ProfileAddressViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileAddressSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ProfileAddress.objects.none()

    def get_queryset(self):
        return ProfileAddress.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class DeleteAllDataView(APIView):
    """POST /api/auth/me/delete-data/ — clear everything this account tracks.

    The account itself survives, so the user stays signed in and can start
    over. Guarded by an explicit `{"confirm": true}` in the body: a destructive
    endpoint should not fire on an empty POST that some retry or prefetch
    could reproduce by accident.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.data.get("confirm") is not True:
            return Response(
                {"detail": "Send {\"confirm\": true} to delete all of your data."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        counts = purge_user_data(request.user)
        return Response({"deleted": counts})
