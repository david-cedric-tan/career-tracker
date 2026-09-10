"""Profile data that doesn't belong on Django's built-in User."""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey, GenericRelation
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


class Profile(models.Model):
    """One-to-one extension of User, created on demand.

    Holds everything user-scoped and non-auth: avatar, contact details beyond
    the login email, and links used to reach the person outside this app.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    avatar = models.ImageField(upload_to="avatars/", null=True, blank=True)

    # FR-PROF-04/05/06 — required at registration (mobile, LinkedIn); school
    # or work email is kept separate from the login email since the two serve
    # different purposes (auth vs "how a recruiter reaches me").
    mobile_number = models.CharField(max_length=32, blank=True)
    school_email = models.EmailField(blank=True)
    linkedin_url = models.URLField(max_length=300, blank=True)

    # A user's own photo for Intern mode, alongside the built-in presets.
    custom_wallpaper = models.ImageField(upload_to="wallpapers/", null=True, blank=True)

    # Appearance (FR-APPEAR-*) — each user's own theme/wallpaper/font picks,
    # not shared across accounts in the same browser. Blank means "unset,
    # use the frontend's own default" rather than a specific choice, so these
    # stay plain CharFields instead of a `choices=` enum that would have to
    # be kept in lockstep with the frontend's own option lists.
    theme_mode = models.CharField(max_length=20, blank=True)
    wallpaper = models.CharField(max_length=20, blank=True)
    wallpaper_blur = models.PositiveSmallIntegerField(null=True, blank=True)
    wallpaper_opacity = models.PositiveSmallIntegerField(null=True, blank=True)
    color_preset = models.CharField(max_length=30, blank=True)
    font_family = models.CharField(max_length=30, blank=True)

    # Null (not False) means "never chose" — the frontend's own default wins,
    # and a teammate signing in on this browser doesn't inherit the last
    # person's answer. Same reasoning as the blank CharFields above.
    celebrations_enabled = models.BooleanField(null=True, blank=True)

    # The dashboard board's own arrangement: {order, hidden, spans}. Opaque to
    # the backend on purpose — widget ids and column spans are the frontend's
    # vocabulary, and a schema here would need updating for every new widget.
    dashboard_layout = models.JSONField(null=True, blank=True)

    # Shown once, right after first login; the user can dismiss it for good.
    onboarding_completed = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile for {self.user.username}"

    @classmethod
    def for_user(cls, user):
        profile, _ = cls.objects.get_or_create(user=user)
        return profile


# ---------------------------------------------------------------------------
# Shared attachment pattern (FR-PROF-13)
#
# Education / Certification / ExtraCurricular all need "attach a file with a
# caption", and duplicating an image-or-document model three times would mean
# three copies of the same validation and cleanup logic. A generic relation
# keeps that logic in one place — the tradeoff (an extra join to fetch the
# owner) is cheap at this scale.
# ---------------------------------------------------------------------------

class AttachmentKind(models.TextChoices):
    IMAGE = "image", "Image"
    DOCUMENT = "document", "Document"


class ProfileAttachment(models.Model):
    """One file on a profile section (education, certification, …)."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    owner = GenericForeignKey("content_type", "object_id")

    file = models.FileField(upload_to="profile_attachments/")
    original_name = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=10, choices=AttachmentKind.choices)
    caption = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["content_type", "object_id"])]

    def __str__(self):
        return self.caption or self.original_name or f"Attachment {self.pk}"


@receiver(post_delete, sender=ProfileAttachment)
def delete_profile_attachment_file(sender, instance, **kwargs):
    """Removing the row removes the file — a post_delete signal so cascades
    (deleting the owning section) clean up storage too, not just rows."""
    if instance.file:
        instance.file.delete(save=False)


class Experience(models.Model):
    """A company the user works or has worked for (FR-EXP-01).

    Distinct from Application: this is where you *have been*, not where you are
    applying. The company comes from the shared catalog so it lines up with
    applications and network contacts at the same employer.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="experiences"
    )
    company = models.ForeignKey(
        "applications.Company", on_delete=models.PROTECT, related_name="experiences"
    )
    title = models.CharField(max_length=255)
    started_on = models.DateField()
    # Blank end date means "current role" — the common case worth modelling.
    ended_on = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ended_on__isnull=True)
                | models.Q(ended_on__gte=models.F("started_on")),
                name="experience_ends_after_it_starts",
            ),
            models.UniqueConstraint(
                fields=["user", "company", "title", "started_on"],
                name="uniq_experience_per_user",
            ),
        ]

    def __str__(self):
        return f"{self.title} at {self.company.name}"

    @property
    def is_current(self):
        return self.ended_on is None


class ExperiencePhoto(models.Model):
    """One image in an experience's gallery (FR-EXP-03)."""

    experience = models.ForeignKey(
        Experience, on_delete=models.CASCADE, related_name="photos"
    )
    image = models.ImageField(upload_to="experiences/")
    caption = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return self.caption or f"Photo {self.pk}"


@receiver(post_delete, sender=ExperiencePhoto)
def delete_experience_photo_file(sender, instance, **kwargs):
    """FR-EXP-06 — removing the row removes the file.

    A post_delete signal rather than an override of `delete()`, so cascades
    (deleting the whole experience) clean up too.
    """
    if instance.image:
        instance.image.delete(save=False)


class Education(models.Model):
    """A school/programme on the user's profile (FR-PROF-10)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="education"
    )
    school = models.CharField(max_length=255)
    degree = models.CharField(max_length=255, blank=True)
    field_of_study = models.CharField(max_length=255, blank=True)
    started_on = models.DateField()
    ended_on = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    attachments = GenericRelation(ProfileAttachment)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ended_on__isnull=True)
                | models.Q(ended_on__gte=models.F("started_on")),
                name="education_ends_after_it_starts",
            ),
        ]

    def __str__(self):
        return f"{self.degree or 'Study'} at {self.school}"

    @property
    def is_current(self):
        return self.ended_on is None


class Certification(models.Model):
    """A credential on the user's profile (FR-PROF-12)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="certifications"
    )
    name = models.CharField(max_length=255)
    issuer = models.CharField(max_length=255, blank=True)
    issued_on = models.DateField(null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    credential_url = models.URLField(max_length=300, blank=True)
    description = models.TextField(blank=True)
    attachments = GenericRelation(ProfileAttachment)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-issued_on", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_on__isnull=True)
                | models.Q(issued_on__isnull=True)
                | models.Q(expires_on__gte=models.F("issued_on")),
                name="certification_expires_after_it_issues",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def is_expired(self):
        from django.utils import timezone

        return bool(self.expires_on and self.expires_on < timezone.localdate())


class ExtraCurricular(models.Model):
    """A club, society or volunteering role on the user's profile (FR-PROF-11)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="extracurriculars"
    )
    organization = models.CharField(max_length=255)
    role = models.CharField(max_length=255, blank=True)
    started_on = models.DateField()
    ended_on = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    attachments = GenericRelation(ProfileAttachment)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        verbose_name = "extra-curricular"
        verbose_name_plural = "extra-curriculars"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ended_on__isnull=True)
                | models.Q(ended_on__gte=models.F("started_on")),
                name="extracurricular_ends_after_it_starts",
            ),
        ]

    def __str__(self):
        return f"{self.role or 'Member'} at {self.organization}"

    @property
    def is_current(self):
        return self.ended_on is None


class LinkCategory(models.TextChoices):
    PORTFOLIO = "portfolio", "Portfolio"
    GITHUB = "github", "GitHub"
    WEBSITE = "website", "Personal site"
    SOCIAL = "social", "Social"
    OTHER = "other", "Other"


class ProfileLink(models.Model):
    """One important link on the user's profile (FR-PROF-07). Optional by
    design — registration shouldn't be walled behind a links list."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="links"
    )
    label = models.CharField(max_length=100)
    url = models.URLField(max_length=300)
    category = models.CharField(
        max_length=20, choices=LinkCategory.choices, default=LinkCategory.OTHER
    )

    class Meta:
        ordering = ["category", "label"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(category__in=[c[0] for c in LinkCategory.choices]),
                name="valid_link_category",
            ),
        ]

    def __str__(self):
        return f"{self.label} ({self.url})"


class ProfileAddress(models.Model):
    """FR-PROF-08 — kept free-text + label rather than structured street/city
    fields: a home address, a uni campus and a mailing address don't share one
    shape, and free text with a label covers all of them without friction."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="addresses"
    )
    label = models.CharField(max_length=100)
    address = models.TextField()

    class Meta:
        ordering = ["label"]

    def __str__(self):
        return self.label
