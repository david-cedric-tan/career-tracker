"""Personal CRM: the people you know at companies, and how to reach them.

Person is a sibling of Application under User (FR-NET), not nested inside an
application — the same contact can matter across several applications, or none.
"""

import calendar
from datetime import date

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from applications.models import Application, Company


class PersonStatus(models.TextChoices):
    LEAD = "lead", "Lead"
    CONNECTION = "connection", "Connection"
    ARCHIVED = "archived", "Archived"
    GHOSTED = "ghosted", "Ghosted"


# Relationship and "met via" used to be fixed TextChoices, like PersonStatus
# still is. Split out into their own small catalogs (RelationshipTag,
# MetSourceTag below) instead — a recruiter you met at a career fair and one
# you met through a referral are both real, common categories a fixed enum
# can't anticipate every one of, and the rest of this app already has a
# pattern for "addable" reference data (Industry, Role): a tiny named model
# plus NamedCatalogViewSet's search + get-or-create `ensure/` endpoint.
PRESET_RELATIONSHIPS = [
    "Mentor", "Alumni", "Classmate", "Colleague", "Manager", "Recruiter",
    "Interviewer", "Industry contact", "Academic", "Other",
]
PRESET_MET_SOURCES = [
    "University event", "Professional event", "Internship", "Workplace",
    "Class", "Referral", "LinkedIn", "Other",
]


class RelationshipTag(models.Model):
    """How you know someone — addable, not a fixed list (FR-NET-20)."""

    name = models.CharField(max_length=50, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class MetSourceTag(models.Model):
    """Where you met someone — addable, not a fixed list (FR-NET-20)."""

    name = models.CharField(max_length=50, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ContactChannel(models.TextChoices):
    LINKEDIN = "linkedin", "LinkedIn"
    EMAIL = "email", "Email"
    WHATSAPP = "whatsapp", "WhatsApp"
    PHONE = "phone", "Phone"
    INSTAGRAM = "instagram", "Instagram"
    OTHER = "other", "Other"


# Fixed cadence (open question 6 in the requirements doc): a catch-up defaults
# to three months after the last one unless the user names a date.
DEFAULT_CADENCE_MONTHS = 3

# A frequency of zero means "never schedule one" — plenty of contacts belong in
# the network without a recurring reminder attached. Distinct from NULL, which
# means "no preference, use the default above".
CADENCE_NEVER = 0


def add_months(start: date, months: int) -> date:
    """Calendar-month arithmetic, clamped to the end of short months.

    31 Jan + 1 month is 28/29 Feb, not an invalid date.
    """
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


class Person(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="people"
    )
    full_name = models.CharField(max_length=255)
    title = models.CharField(max_length=255, blank=True)
    photo = models.ImageField(upload_to="people/", null=True, blank=True)

    status = models.CharField(
        max_length=20, choices=PersonStatus.choices, default=PersonStatus.LEAD
    )
    relationship = models.ForeignKey(
        RelationshipTag, on_delete=models.SET_NULL, null=True, blank=True, related_name="people"
    )
    source = models.ForeignKey(
        MetSourceTag, on_delete=models.SET_NULL, null=True, blank=True, related_name="people"
    )

    companies = models.ManyToManyField(Company, blank=True, related_name="people")
    applications = models.ManyToManyField(
        Application, blank=True, related_name="people"
    )

    last_meeting_at = models.DateField(null=True, blank=True)
    next_chat_at = models.DateField(null=True, blank=True)
    # Null means "use DEFAULT_CADENCE_MONTHS" — a contact you catch up with
    # monthly and one you catch up with yearly shouldn't share one fixed
    # reminder cadence just because both are blank. `CADENCE_NEVER` (0) opts
    # the person out of scheduling altogether.
    cadence_months = models.PositiveSmallIntegerField(null=True, blank=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["full_name"]
        verbose_name_plural = "people"
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["next_chat_at"]),
        ]
        constraints = [
            # FR-NET-12 — one row per person per user, keyed on their name.
            models.UniqueConstraint(
                fields=["user", "full_name"], name="uniq_person_name_per_user"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=[c[0] for c in PersonStatus.choices]),
                name="valid_person_status",
            ),
        ]

    def __str__(self):
        return self.full_name

    def clean(self):
        if self.last_meeting_at and self.next_chat_at:
            if self.next_chat_at < self.last_meeting_at:
                raise ValidationError(
                    {"next_chat_at": "Next chat cannot be before the last meeting."}
                )

    def apply_cadence_default(self):
        """FR-NET-10 — blank next chat defaults to last meeting + this
        person's own frequency (or the 3-month default if they haven't set
        one). A frequency of `CADENCE_NEVER` derives nothing at all.

        An explicit value is never overwritten, so callers can run this on
        every save — including a follow-up date named on a catch-up, which
        still stands even for a contact set to never auto-schedule.
        """
        if self.cadence_months == CADENCE_NEVER:
            return self.next_chat_at
        if self.next_chat_at is None and self.last_meeting_at is not None:
            # Explicit None check, not `or`: 0 is a real setting here, and
            # would otherwise fall through to the default.
            months = (
                DEFAULT_CADENCE_MONTHS if self.cadence_months is None else self.cadence_months
            )
            self.next_chat_at = add_months(self.last_meeting_at, months)
        return self.next_chat_at

    @property
    def preferred_contact(self):
        return (
            self.contact_methods.filter(is_preferred=True).first()
            or self.contact_methods.first()
        )


class ContactMethod(models.Model):
    """FR-NET-06 — a person can be reachable on several channels at once."""

    person = models.ForeignKey(
        Person, on_delete=models.CASCADE, related_name="contact_methods"
    )
    channel = models.CharField(max_length=20, choices=ContactChannel.choices)
    value = models.CharField(max_length=255)
    is_preferred = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_preferred", "channel"]
        constraints = [
            models.UniqueConstraint(
                fields=["person", "channel", "value"], name="uniq_contact_per_person"
            ),
            models.CheckConstraint(
                condition=models.Q(channel__in=[c[0] for c in ContactChannel.choices]),
                name="valid_contact_channel",
            ),
        ]

    def __str__(self):
        return f"{self.person.full_name} — {self.get_channel_display()}: {self.value}"
