from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from config.images import validate_image

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

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """The account plus the profile fields that live alongside it.

    `mobile_number` / `school_email` / `linkedin_url` are columns on `Profile`,
    not `User` — exposed here as plain fields (rather than nested) so the
    Profile page can PATCH `/api/auth/me/` in one request instead of two.
    """

    avatar = serializers.SerializerMethodField()
    custom_wallpaper = serializers.SerializerMethodField()
    mobile_number = serializers.CharField(
        source="profile.mobile_number", required=False, allow_blank=True, max_length=32
    )
    school_email = serializers.EmailField(
        source="profile.school_email", required=False, allow_blank=True
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
            "mobile_number",
            "school_email",
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
        )
        read_only_fields = ("id", "date_joined", "avatar", "custom_wallpaper")

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
    company_name = serializers.CharField(source="company.name", read_only=True)
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
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = Education
        fields = [
            "id", "school", "degree", "field_of_study",
            "started_on", "ended_on", "is_current", "description",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_current", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "started_on", "ended_on", "The end date can’t be before the start date."
    )


class CertificationSerializer(serializers.ModelSerializer):
    attachments = ProfileAttachmentSerializer(many=True, read_only=True)
    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Certification
        fields = [
            "id", "name", "issuer", "issued_on", "expires_on",
            "credential_url", "description", "is_expired",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_expired", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "issued_on", "expires_on", "Expiry can’t be before the issue date."
    )


class ExtraCurricularSerializer(serializers.ModelSerializer):
    attachments = ProfileAttachmentSerializer(many=True, read_only=True)
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = ExtraCurricular
        fields = [
            "id", "organization", "role",
            "started_on", "ended_on", "is_current", "description",
            "attachments", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_current", "attachments", "created_at", "updated_at"]

    validate = _date_order_validator(
        "started_on", "ended_on", "The end date can’t be before the start date."
    )


class ProfileLinkSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = ProfileLink
        fields = ["id", "label", "url", "category", "category_display"]
        read_only_fields = ["id", "category_display"]

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value


class ProfileAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProfileAddress
        fields = ["id", "label", "address"]
        read_only_fields = ["id"]

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field is required.")
        return value
