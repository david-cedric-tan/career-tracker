"""Profile data that doesn't belong on Django's built-in User."""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey, GenericRelation
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone


def is_owner_username(username):
    """Whether this username is the app's maintainer.

    Matched case-insensitively, because the account is typed by hand at
    registration and "davieetan" and "DavieeTan" are the same person.
    """
    owner = getattr(settings, "DEVELOPER_USERNAME", "")
    return bool(owner) and (username or "").strip().lower() == owner.strip().lower()


class PasswordResetRequest(models.Model):
    """"I forgot my password" — raised from the login screen, answered by a
    superuser in the console.

    There is no email round-trip in this app (no mail server, and most
    accounts are people the operator knows), so a reset is a person asking
    the operator to set a new one. The request is the queue: it shows the
    operator who asked and when, and clears once they set a password on
    that account.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="password_reset_requests"
    )
    message = models.CharField(max_length=280, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Reset request from {self.user_id}"


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
    # What the app calls you — "Dave" rather than "David Cedric" — short
    # enough to fit the sidebar and the dashboard greeting.
    preferred_name = models.CharField(max_length=40, blank=True)
    school_email = models.EmailField(blank=True)
    # A third address, kept apart from both the login email and the school/work
    # one: the address you'd actually want a recruiter to use after you
    # graduate and the university mailbox stops being read.
    personal_email = models.EmailField(blank=True)
    linkedin_url = models.URLField(max_length=300, blank=True)

    # A user's own photo for Intern mode, alongside the built-in presets.
    custom_wallpaper = models.ImageField(upload_to="wallpapers/", null=True, blank=True)

    # Dashboard desk photo — follows the account across devices, unlike the
    # old browser-only IndexedDB copy which made two people on one machine
    # share (or steal) each other's pin.
    pinned_photo = models.ImageField(upload_to="pinned/", null=True, blank=True)
    pinned_photo_caption = models.CharField(max_length=200, blank=True)

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

    # Whoever maintains the app. Grants one thing only: reading and replying to
    # every account's refinement notes, so complaints reach someone who can act
    # on them. Deliberately not `is_staff` — that opens the Django admin, which
    # is a much bigger grant than "can read the suggestion box".
    is_developer = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile for {self.user.username}"

    @classmethod
    def for_user(cls, user):
        # The single place profiles come into existence, so it is also where the
        # owner's flag is applied — otherwise a fresh database created after the
        # granting migration would leave the maintainer without it.
        profile, created = cls.objects.get_or_create(
            user=user, defaults={"is_developer": is_owner_username(user.username)}
        )
        if not created and not profile.is_developer and is_owner_username(user.username):
            profile.is_developer = True
            profile.save(update_fields=["is_developer"])
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
    # A small identifying mark — a university crest, an issuer's logo, a club
    # badge. Separate from `attachments`, which is a gallery of evidence: this
    # is the one image that represents the entry in a list.
    icon = models.ImageField(upload_to="section_icons/", null=True, blank=True)

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
    # A small identifying mark — a university crest, an issuer's logo, a club
    # badge. Separate from `attachments`, which is a gallery of evidence: this
    # is the one image that represents the entry in a list.
    icon = models.ImageField(upload_to="section_icons/", null=True, blank=True)

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
    # A small identifying mark — a university crest, an issuer's logo, a club
    # badge. Separate from `attachments`, which is a gallery of evidence: this
    # is the one image that represents the entry in a list.
    icon = models.ImageField(upload_to="section_icons/", null=True, blank=True)

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
    WEBSITE = "website", "Personal Site"
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
    position = models.PositiveIntegerField(default=0)
    # An optional favicon-ish mark, so a list of links is scannable by sight
    # rather than by reading every label.
    icon = models.ImageField(upload_to="section_icons/", null=True, blank=True)

    class Meta:
        # Hand-arranged order wins; `id` breaks ties so a list that has never
        # been dragged (every position still 0) stays stable rather than
        # coming back in whatever order the database feels like.
        ordering = ["position", "id"]
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
    # Optional, and deliberately not parsed out of `address`: guessing a
    # country from free text is wrong often enough to be worse than asking.
    # Drawn from the same catalog the region map uses.
    country = models.ForeignKey(
        "applications.Country",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="profile_addresses",
    )

    class Meta:
        ordering = ["label"]

    def __str__(self):
        return self.label


class RefinementKind(models.TextChoices):
    IMPROVEMENT = "improvement", "Improvement"
    BUG = "bug", "Bug"
    COMPLAINT = "complaint", "Complaint"


class RefinementStatus(models.TextChoices):
    OPEN = "open", "Open"
    TESTING = "testing", "Testing"
    AWAITING_VALIDATION = "awaiting_validation", "Awaiting validation"
    DONE = "done", "Done"


# Statuses a developer can park a ticket in without writing a fix reply.
# `done` stays reserved for resolve / self-close.
REFINEMENT_DEV_STATUSES = {
    RefinementStatus.OPEN,
    RefinementStatus.TESTING,
    RefinementStatus.AWAITING_VALIDATION,
}


# The app's screens, as ticket tags. Kept here rather than accepting free text
# so the developer's inbox can be filtered by area — a tag set that anyone can
# extend by typing becomes twelve spellings of "dashboard" within a month.
TICKET_SCREENS = [
    ("dashboard", "Dashboard"),
    ("applications", "Applications"),
    ("network", "Network"),
    ("catchups", "Catch-ups"),
    ("todos", "Todos"),
    ("calendar", "Calendar"),
    ("resumes", "Resumes"),
    ("job_directory", "Job Directory"),
    ("refinement_log", "Refinement Log"),
    ("profile", "Profile"),
    ("settings", "Settings"),
    ("other", "Somewhere else"),
]
TICKET_SCREEN_VALUES = {value for value, _ in TICKET_SCREENS}


class RefinementNote(models.Model):
    """One logged refinement, complaint or bug.

    Written as a private notebook — "the thing that annoyed me just now" — and
    read two ways. The person who wrote it sees only their own notes. Whoever
    maintains the app (`Profile.is_developer`) sees everyone's, because a
    complaint nobody can read is not worth the typing, and replies to it with
    `resolution`. The reply travels back to the reporter, which is why the
    fields below track not just that something was fixed but whether the person
    who raised it has actually seen the answer.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="refinements"
    )
    body = models.TextField()
    kind = models.CharField(
        max_length=20, choices=RefinementKind.choices, default=RefinementKind.IMPROVEMENT
    )
    status = models.CharField(
        max_length=20, choices=RefinementStatus.choices, default=RefinementStatus.OPEN
    )
    # Where the user was when they logged it, so a note like "this is confusing"
    # is still actionable a fortnight later.
    page = models.CharField(max_length=255, blank=True)
    # Which screens the reporter says are affected, as a list of slugs from
    # `TICKET_SCREENS`. A free-text page path says where they happened to be
    # standing; this says what the complaint is actually about, which is often
    # somewhere else entirely.
    screens = models.JSONField(default=list, blank=True)
    # What the developer wrote back when they fixed it. Blank on a note the
    # reporter simply ticked off themselves — resolving your own note is not
    # the same event as someone answering you.
    resolution = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refinements_resolved",
    )
    # Null while the reporter still owes a look at the reply. This is what makes
    # the answer a notification rather than something you'd only find by
    # scrolling back through old notes.
    resolution_seen_at = models.DateTimeField(null=True, blank=True)
    # When each side last opened the conversation below. Two markers rather than
    # a per-message read flag: there are only ever two people in a ticket, and
    # "everything before this moment has been seen" is all either of them needs
    # to know.
    owner_read_at = models.DateTimeField(null=True, blank=True)
    developer_read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return self.body[:60]

    @property
    def has_unseen_resolution(self):
        return bool(self.resolution) and self.resolution_seen_at is None

    @property
    def is_locked(self):
        """Answered tickets stop being editable.

        Otherwise the reply stops making sense: the developer writes "fixed the
        calendar scroll", the reporter edits the note to say something else, and
        the thread now reads as an answer to a question nobody asked. Ticking
        your own note off doesn't lock it — only a reply does.
        """
        return bool(self.resolution)

    def read_marker_for(self, user):
        """Which side of the conversation this user is on."""
        return "owner_read_at" if user.id == self.user_id else "developer_read_at"

    def unread_count_for(self, user):
        """Messages from the other person this user hasn't opened yet."""
        since = getattr(self, self.read_marker_for(user))
        messages = self.messages.exclude(user=user)
        if since is not None:
            messages = messages.filter(created_at__gt=since)
        return messages.count()


class RefinementMessage(models.Model):
    """One turn in the back-and-forth on a ticket.

    A complaint is rarely complete on its own — "the calendar is broken" needs
    a "broken how?" before anything can be done about it, and that exchange
    belongs on the ticket rather than in a separate conversation nobody can
    find later. Either party can attach a picture, which is usually the fastest
    way to answer "show me".

    Only the two people involved can read a thread: whoever raised the ticket,
    and whoever maintains the app.
    """

    note = models.ForeignKey(
        RefinementNote, on_delete=models.CASCADE, related_name="messages"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="refinement_messages",
    )
    # Blank when the picture *is* the message — a screenshot on its own is a
    # perfectly good answer to "what does it look like".
    body = models.TextField(blank=True)
    image = models.ImageField(upload_to="refinements/", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return self.body[:60] or "(attachment)"


class RefinementEventType(models.TextChoices):
    RAISED = "raised", "Raised"
    EDITED = "edited", "Edited"
    FIXED = "fixed", "Fixed"
    REOPENED = "reopened", "Reopened"
    CLOSED = "closed", "Closed"
    TESTING = "testing", "Testing"
    AWAITING_VALIDATION = "awaiting_validation", "Awaiting validation"


class RefinementEventLog(models.Model):
    """Append-only history for one ticket — same idea as application event logs.

    Status moves (raised → fixed → reopened → fixed again) are the story people
    come back to read. Field edits are recorded too, but the UI can tuck those
    away the way application history hides tidy-up edits.
    """

    note = models.ForeignKey(
        RefinementNote, on_delete=models.CASCADE, related_name="event_logs"
    )
    event_type = models.CharField(max_length=20, choices=RefinementEventType.choices)
    # Free-text payload: the fix reply for `fixed`, otherwise blank.
    detail = models.TextField(blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refinement_events",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.note_id} {self.event_type} @ {self.created_at}"


def log_refinement_event(note, event_type, *, actor=None, detail="", at=None):
    """Write one history row. Kept as a helper so views don't invent formats."""
    kwargs = {"note": note, "event_type": event_type, "actor": actor, "detail": detail or ""}
    if at is not None:
        kwargs["created_at"] = at
    return RefinementEventLog.objects.create(**kwargs)
