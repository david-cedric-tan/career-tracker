import os
import secrets

from django.contrib.auth import login, logout
from django.contrib.contenttypes.models import ContentType
from rest_framework import generics, permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
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
)
from .serializers import (
    AvatarSerializer,
    CertificationSerializer,
    EducationSerializer,
    ExperiencePhotoUploadSerializer,
    ExperienceSerializer,
    ExtraCurricularSerializer,
    LoginSerializer,
    ProfileAddressSerializer,
    ProfileAttachmentUploadSerializer,
    ProfileLinkSerializer,
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


class EducationViewSet(AttachmentSectionMixin, viewsets.ModelViewSet):
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


class CertificationViewSet(AttachmentSectionMixin, viewsets.ModelViewSet):
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


class ExtraCurricularViewSet(AttachmentSectionMixin, viewsets.ModelViewSet):
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


class ProfileLinkViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileLinkSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = ProfileLink.objects.none()

    def get_queryset(self):
        return ProfileLink.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


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
