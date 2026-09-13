from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from config.images import GALLERY_SIZE, contain_thumbnail, validate_image

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
    RefinementEventLog,
    RefinementMessage,
    RefinementNote,
    RefinementStatus,
    TICKET_SCREENS,
    TICKET_SCREEN_VALUES,
)

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """The account plus the profile fields that live alongside it.

    `mobile_number` / `school_email` / `linkedin_url` are columns on `Profile`,
    not `User` — exposed here as plain fields (rather than nested) so the
    Profile page can PATCH `/api/auth/me/` in one request instead of two.
    """

    avatar = serializers.SerializerMethodField()
    custom_wallpaper = serializers.SerializerMethodField()
    pinned_photo = serializers.SerializerMethodField()
    pinned_photo_caption = serializers.CharField(
        source="profile.pinned_photo_caption", read_only=True
    )
    mobile_number = serializers.CharField(
        source="profile.mobile_number", required=False, allow_blank=True, max_length=32
    )
    preferred_name = serializers.CharField(
        source="profile.preferred_name", required=False, allow_blank=True, max_length=40
    )
    school_email = serializers.EmailField(
        source="profile.school_email", required=False, allow_blank=True
    )
    personal_email = serializers.EmailField(
        source="profile.personal_email", required=False, allow_blank=True
    )
    linkedin_url = serializers.URLField(
        source="profile.linkedin_url", required=False, allow_blank=True, max_length=300
    )
    # Read/write directly (not nested under profile.*) since the onboarding
    # tour toggles this itself via a plain PATCH, same call shape as the rest
    # of this serializer's fields.
    onboarding_completed = serializers.BooleanField(
        source="profile.onboarding_completed", required=False
    )
    # Appearance — each is blank/null until the user actually picks something,
    # so the frontend's own default applies until then. Plain strings/ints
    # rather than a `choices=` enum: the valid option set lives in the
    # frontend (lib/appearance.ts, presetThemes.ts, fonts.ts) and this just
    # stores whatever it's given.
    theme_mode = serializers.CharField(
        source="profile.theme_mode", required=False, allow_blank=True, max_length=20
    )
    wallpaper = serializers.CharField(
        source="profile.wallpaper", required=False, allow_blank=True, max_length=20
    )
    wallpaper_blur = serializers.IntegerField(
        source="profile.wallpaper_blur", required=False, allow_null=True
    )
    wallpaper_opacity = serializers.IntegerField(
        source="profile.wallpaper_opacity", required=False, allow_null=True
    )
    color_preset = serializers.CharField(
        source="profile.color_preset", required=False, allow_blank=True, max_length=30
    )
    font_family = serializers.CharField(
        source="profile.font_family", required=False, allow_blank=True, max_length=30
    )
    celebrations_enabled = serializers.BooleanField(
        source="profile.celebrations_enabled", required=False, allow_null=True
    )
    dashboard_layout = serializers.JSONField(
        source="profile.dashboard_layout", required=False, allow_null=True
    )
    # Read-only on purpose: this decides who can read everyone's refinement
    # notes, so it is granted server-side and can't be switched on by PATCHing
    # your own profile.
    is_developer = serializers.BooleanField(source="profile.is_developer", read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "date_joined",
            "avatar",
            "custom_wallpaper",
            "pinned_photo",
            "pinned_photo_caption",
            "mobile_number",
            "preferred_name",
            "school_email",
            "personal_email",
            "linkedin_url",
            "onboarding_completed",
            "theme_mode",
            "wallpaper",
            "wallpaper_blur",
            "wallpaper_opacity",
            "color_preset",
            "font_family",
            "celebrations_enabled",
            "dashboard_layout",
            "is_developer",
        )
        read_only_fields = (
            "id",
            "date_joined",
            "avatar",
            "custom_wallpaper",
            "pinned_photo",
            "pinned_photo_caption",
            "is_developer",
        )

    def get_avatar(self, user):
        """Absolute URL so the SPA on :5173 can load it from the API origin."""
        profile = getattr(user, "profile", None)
        if not profile or not profile.avatar:
            return None
        request = self.context.get("request")
        url = profile.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_custom_wallpaper(self, user):
        profile = getattr(user, "profile", None)
        if not profile or not profile.custom_wallpaper:
            return None
        request = self.context.get("request")
        url = profile.custom_wallpaper.url
        return request.build_absolute_uri(url) if request else url

    def get_pinned_photo(self, user):
        profile = getattr(user, "profile", None)
        if not profile or not profile.pinned_photo:
            return None
        request = self.context.get("request")
        url = profile.pinned_photo.url
        return request.build_absolute_uri(url) if request else url

    def validate_email(self, value):
        value = value.strip()
        clash = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if value and clash.exists():
            raise serializers.ValidationError("That email is already registered.")
        return value

    def update(self, instance, validated_data):
        # DRF's nested-source support only reads through dots; a plain
        # ModelSerializer.update() would try (and fail) to set `profile` on
        # User directly, so the profile.* fields are lifted out and applied
        # to the Profile row by hand.
        profile_data = validated_data.pop("profile", {})
        instance = super().update(instance, validated_data)
        if profile_data:
            profile = Profile.for_user(instance)
            for field, value in profile_data.items():
                setattr(profile, field, value)
            profile.save()
        return instance


class AvatarSerializer(serializers.Serializer):
    """Multipart-only: the profile picture is uploaded on its own endpoint so
    the JSON profile form never has to become a multipart request."""

    avatar = serializers.ImageField(write_only=True)

    def validate_avatar(self, value):
        return validate_image(value)


class WallpaperSerializer(serializers.Serializer):
    """Multipart-only: a user's own photo for Intern mode, alongside the
    built-in presets."""

    wallpaper = serializers.ImageField(write_only=True)

    def validate_wallpaper(self, value):
        return validate_image(value)


class PinnedPhotoSerializer(serializers.Serializer):
    """Multipart-only: the dashboard desk photo."""

    photo = serializers.ImageField(write_only=True)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate_photo(self, value):
        return validate_image(value)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    password_confirm = serializers.CharField(
        write_only=True, style={"input_type": "password"}
    )
    email = serializers.EmailField(required=True)
    first_name = serializers.CharField(required=True, max_length=150)
    last_name = serializers.CharField(required=True, max_length=150)
    # FR-PROF-04/06 — required so contact details exist from day one; the
    # links/addresses/education/etc. panels stay optional so registration
    # itself isn't a wall.
    mobile_number = serializers.CharField(required=True, max_length=32)
    linkedin_url = serializers.URLField(required=True, max_length=300)
    school_email = serializers.EmailField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = (
            "username",
            "email",
            "password",
            "password_confirm",
            "first_name",
            "last_name",
            "mobile_number",
            "linkedin_url",
            "school_email",
        )

    def validate_username(self, value):
        value = value.strip()
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate_email(self, value):
        value = value.strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("That email is already registered.")
        return value

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value

    def validate_mobile_number(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Passwords do not match."}
            )
        # Run Django's validators against a throwaway user so rules like
        # UserAttributeSimilarityValidator can compare against the username.
        candidate = User(username=attrs.get("username"), email=attrs.get("email"))
        try:
            validate_password(attrs["password"], user=candidate)
        except serializers.DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        mobile_number = validated_data.pop("mobile_number")
        linkedin_url = validated_data.pop("linkedin_url")
        school_email = validated_data.pop("school_email", "")

        user = User.objects.create_user(**validated_data)
        Profile.objects.create(
            user=user,
            mobile_number=mobile_number,
            linkedin_url=linkedin_url,
            school_email=school_email,
        )
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        user = authenticate(
            username=attrs["username"],
            password=attrs["password"],
        )
        if not user:
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active:
            raise serializers.ValidationError("User account is disabled.")
        attrs["user"] = user
        return attrs


class ExperiencePhotoSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = ExperiencePhoto
        fields = ["id", "image", "caption", "created_at"]
        read_only_fields = ["id", "image", "created_at"]

    def get_image(self, photo):
        request = self.context.get("request")
        url = photo.image.url
        return request.build_absolute_uri(url) if request else url


class ExperiencePhotoUploadSerializer(serializers.Serializer):
    """Multipart-only — the experience form itself stays JSON."""

    image = serializers.ImageField(write_only=True)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate_image(self, value):
        return validate_image(value)


class ExperienceSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.display_name", read_only=True)
    company_logo = serializers.SerializerMethodField()
    photos = ExperiencePhotoSerializer(many=True, read_only=True)
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = Experience
        fields = [
            "id",
            "company", "company_name", "company_logo",
            "title",
            "started_on",
            "ended_on",
            "is_current",
            "description",
            "photos",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "company_name", "company_logo", "photos", "is_current",
            "created_at", "updated_at",
        ]

    def get_company_logo(self, experience):
        logo = experience.company.logo
        if not logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(logo.url) if request else logo.url

    def validate(self, attrs):
        started = attrs.get("started_on", getattr(self.instance, "started_on", None))
        ended = attrs.get("ended_on", getattr(self.instance, "ended_on", None))
        if started and ended and ended < started:
            raise serializers.ValidationError(
                {"ended_on": "The end date can’t be before the start date."}
            )
        return attrs


# ---------------------------------------------------------------------------
# Shared attachment serializers (FR-PROF-13)
# ---------------------------------------------------------------------------

class ProfileAttachmentSerializer(serializers.ModelSerializer):
    file = serializers.SerializerMethodField()

    class Meta:
        model = ProfileAttachment
        fields = ["id", "file", "original_name", "kind", "caption", "created_at"]
        read_only_fields = fields

    def get_file(self, attachment):
        request = self.context.get("request")
        url = attachment.file.url
        return request.build_absolute_uri(url) if request else url


class SectionIconSerializer(serializers.Serializer):
    """Multipart-only, on its own endpoint, so the JSON section forms stay
    JSON — the same split the avatar and company logo already use."""

    icon = serializers.ImageField(write_only=True)

    def validate_icon(self, value):
        return validate_image(value)


class ProfileAttachmentUploadSerializer(serializers.Serializer):
    """Multipart-only — classification happens in the view, since it decides
    which storage helper (square crop vs raw) processes the file."""

    file = serializers.FileField(write_only=True)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=255)


def _date_order_validator(start_field, end_field, message):
    def validate(self, attrs):
        start = attrs.get(start_field, getattr(self.instance, start_field, None))
        end = attrs.get(end_field, getattr(self.instance, end_field, None))
        if start and end and end < start:
            raise serializers.ValidationError({end_field: message})
        return attrs

    return validate


class EducationSerializer(serializers.ModelSerializer):
    attachments = ProfileAttachmentSerializer(many=True, read_only=True)
    icon = serializers.SerializerMethodField()

    def get_icon(self, row):
        """Absolute URL so the SPA can load it from the API origin."""
        if not row.icon:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(row.icon.url) if request else row.icon.url

    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = Education
        fields = [
            "id", "school", "degree", "field_of_study",
            "started_on", "ended_on", "is_current", "description",
            "icon",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_current", "icon", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "started_on", "ended_on", "The end date can’t be before the start date."
    )


class CertificationSerializer(serializers.ModelSerializer):
    attachments = ProfileAttachmentSerializer(many=True, read_only=True)
    icon = serializers.SerializerMethodField()

    def get_icon(self, row):
        """Absolute URL so the SPA can load it from the API origin."""
        if not row.icon:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(row.icon.url) if request else row.icon.url

    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Certification
        fields = [
            "id", "name", "issuer", "issued_on", "expires_on",
            "credential_url", "description", "is_expired",
            "icon",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_expired", "icon", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "issued_on", "expires_on", "Expiry can’t be before the issue date."
    )


class ExtraCurricularSerializer(serializers.ModelSerializer):
    attachments = ProfileAttachmentSerializer(many=True, read_only=True)
    icon = serializers.SerializerMethodField()

    def get_icon(self, row):
        """Absolute URL so the SPA can load it from the API origin."""
        if not row.icon:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(row.icon.url) if request else row.icon.url

    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = ExtraCurricular
        fields = [
            "id", "organization", "role",
            "started_on", "ended_on", "is_current", "description",
            "icon",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_current", "icon", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "started_on", "ended_on", "The end date can’t be before the start date."
    )


class ProfileLinkSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    icon = serializers.SerializerMethodField()

    def get_icon(self, row):
        """Absolute URL so the SPA can load it from the API origin."""
        if not row.icon:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(row.icon.url) if request else row.icon.url


    class Meta:
        model = ProfileLink
        fields = [
            "id", "label", "url", "category", "category_display", "position", "icon",
        ]
        read_only_fields = ["id", "category_display", "position", "icon"]

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value


class ProfileAddressSerializer(serializers.ModelSerializer):
    country_name = serializers.CharField(source="country.name", read_only=True, default=None)

    class Meta:
        model = ProfileAddress
        fields = ["id", "label", "address", "country", "country_name"]
        read_only_fields = ["id", "country_name"]

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value


def _display_name(user):
    return (user.get_full_name() or "").strip() or user.get_username()


def _avatar_url(user, request):
    """Absolute URL for a profile picture, or None to fall back to initials.

    Read defensively: a profile row can be missing on an account created before
    profiles existed, and a picture is not worth a 500.
    """
    profile = getattr(user, "profile", None)
    if not profile or not profile.avatar:
        return None
    url = profile.avatar.url
    return request.build_absolute_uri(url) if request else url


class RefinementMessageSerializer(serializers.ModelSerializer):
    """One message in a ticket thread, with an optional picture.

    The picture is re-encoded like every other upload in the app rather than
    stored as sent — a screenshot straight off a phone is several megabytes of
    something that will be read at a few hundred pixels wide.
    """

    author = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    image = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = RefinementMessage
        fields = ["id", "body", "image", "created_at", "author", "author_avatar", "is_mine"]
        read_only_fields = ["id", "created_at", "author", "author_avatar", "is_mine"]

    def get_author(self, message):
        return _display_name(message.user)

    def get_author_avatar(self, message):
        return _avatar_url(message.user, self.context.get("request"))

    def get_is_mine(self, message):
        request = self.context.get("request")
        return bool(request) and message.user_id == request.user.id

    def validate_image(self, value):
        if value in (None, ""):
            return value
        validate_image(value)
        return contain_thumbnail(value, size=GALLERY_SIZE, name="ticket")

    def validate(self, attrs):
        """A message has to actually say something — text, a picture, or both."""
        body = (attrs.get("body") or "").strip()
        if not body and not attrs.get("image"):
            raise serializers.ValidationError(
                {"body": ["Write something, or attach a picture."]}
            )
        attrs["body"] = body
        return attrs


class RefinementEventLogSerializer(serializers.ModelSerializer):
    event_type_display = serializers.CharField(
        source="get_event_type_display", read_only=True
    )
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = RefinementEventLog
        fields = [
            "id",
            "event_type",
            "event_type_display",
            "detail",
            "actor_name",
            "created_at",
        ]

    def get_actor_name(self, event):
        if not event.actor_id:
            return None
        return _display_name(event.actor)


class RefinementNoteSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # Who raised it. Only meaningful in the developer's all-accounts view, but
    # always sent: it costs one already-loaded row and saves the client from
    # having to ask a second question about whose note it is looking at.
    author = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    resolution = serializers.CharField(read_only=True)
    screen_labels = serializers.SerializerMethodField()
    is_locked = serializers.BooleanField(read_only=True)
    # Enough of the thread to drive a badge and a notification line without
    # fetching every message for every row in the list.
    message_count = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    event_logs = RefinementEventLogSerializer(many=True, read_only=True)
    # Drives the notifications panel's Tickets feed without a second endpoint.
    needs_attention = serializers.SerializerMethodField()

    class Meta:
        model = RefinementNote
        fields = [
            "id", "body", "kind", "kind_display", "status", "status_display",
            "page", "screens", "screen_labels", "created_at", "updated_at",
            "author", "author_avatar", "is_mine", "is_locked",
            "resolution", "resolved_at", "resolved_by_name", "resolution_seen_at",
            "message_count", "unread_count", "last_message", "event_logs",
            "needs_attention",
        ]
        read_only_fields = [
            "id", "kind_display", "status_display", "created_at", "updated_at",
            "author", "author_avatar", "is_mine", "is_locked", "screen_labels",
            "resolution", "resolved_at", "resolved_by_name", "resolution_seen_at",
            "message_count", "unread_count", "last_message", "event_logs",
            "needs_attention",
        ]

    def get_message_count(self, note):
        return note.messages.count()

    def get_unread_count(self, note):
        request = self.context.get("request")
        return note.unread_count_for(request.user) if request else 0

    def get_needs_attention(self, note):
        """Whether this ticket belongs in the notifications Tickets feed.

        Reporters: an unseen fix reply, or unread chat from the developer.
        Developers on someone else's ticket: unread chat, or a ticket they've
        never opened yet (so brand-new filings surface without a message).
        """
        request = self.context.get("request")
        if not request:
            return False
        user = request.user
        if note.user_id == user.id:
            if note.resolution and note.resolution_seen_at is None:
                return True
            return note.unread_count_for(user) > 0
        if note.unread_count_for(user) > 0:
            return True
        if note.status == RefinementStatus.DONE:
            return False
        return getattr(note, note.read_marker_for(user)) is None

    def get_last_message(self, note):
        message = note.messages.order_by("-created_at", "-id").first()
        if not message:
            return None
        request = self.context.get("request")
        return {
            "author": _display_name(message.user),
            "is_mine": bool(request) and message.user_id == request.user.id,
            "created_at": message.created_at,
            # A one-line preview: enough to recognise in a notification, and
            # not a second copy of the thread in every list response.
            "preview": message.body[:80] or "Sent a picture",
        }

    def get_screen_labels(self, note):
        labels = dict(TICKET_SCREENS)
        return [labels[slug] for slug in note.screens or [] if slug in labels]

    def validate_screens(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Send a list of screen names.")
        unknown = [slug for slug in value if slug not in TICKET_SCREEN_VALUES]
        if unknown:
            raise serializers.ValidationError(
                f"Not screens in this app: {', '.join(map(str, unknown))}."
            )
        # Deduplicated but order-preserving, so the tags read in the order they
        # were picked rather than jumping around after every save.
        return list(dict.fromkeys(value))

    def get_author(self, note):
        return _display_name(note.user)

    def get_author_avatar(self, note):
        return _avatar_url(note.user, self.context.get("request"))

    def get_is_mine(self, note):
        request = self.context.get("request")
        return bool(request) and note.user_id == request.user.id

    def get_resolved_by_name(self, note):
        if not note.resolved_by:
            return None
        name = (note.resolved_by.get_full_name() or "").strip()
        return name or note.resolved_by.get_username()

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Write something before logging it.")
        return value
