"""Personal CRM: the people you know at companies, and how to reach them.

Person is a sibling of Application under User (FR-NET), not nested inside an
application — the same contact can matter across several applications, or none.
"""

import calendar
from datetime import date

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

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
    "Interviewer", "Industry Contact", "Academic", "Other",
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


class MessageChannel(models.TextChoices):
    LINKEDIN = "linkedin", "LinkedIn"
    EMAIL = "email", "Email"
    SMS = "sms", "Text / WhatsApp"
    OTHER = "other", "Other"


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

    companies = models.ManyToManyField(
        Company, blank=True, related_name="people", through="PersonCompany"
    )
    applications = models.ManyToManyField(
        Application, blank=True, related_name="people"
    )
    # Who introduced whom, who works alongside whom. Symmetrical (Django's
    # default for a self-M2M) because "Andrew knows Daniel" is not a claim that
    # holds in one direction only — recording it once shows it on both
    # profiles, with no second row to keep in step.
    connections = models.ManyToManyField("self", blank=True)

    last_meeting_at = models.DateField(null=True, blank=True)
    # A message isn't a meeting: pinging someone on LinkedIn shouldn't read as
    # having caught up with them, nor reset the catch-up cadence. Tracked
    # separately, with the channel it went through.
    last_messaged_at = models.DateField(null=True, blank=True)
    last_message_channel = models.CharField(
        max_length=20, blank=True, choices=MessageChannel.choices
    )
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


class PersonCompany(models.Model):
    """Where a contact works, or worked.

    A through model rather than a plain M2M because "I knew them at Deloitte,
    they're at EY now" is a normal thing to track, and a flat relation can only
    say they're attached to both.

    Every field beyond the pair itself is optional on purpose: most contacts get
    added in a hurry with no dates at all, and that has to keep working. What
    "past" means is derived from whatever the user did fill in — see `is_past`.
    """

    person = models.ForeignKey(
        "Person", on_delete=models.CASCADE, related_name="company_links"
    )
    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="person_links"
    )
    # Their title *at this company* — distinct from Person.title, which is
    # whatever they do now.
    title = models.CharField(max_length=255, blank=True)
    started_on = models.DateField(null=True, blank=True)
    ended_on = models.DateField(null=True, blank=True)
    # Null means "never said" — the derivation falls through to the dates.
    # False is an explicit "they've left" for when the date isn't known.
    is_current = models.BooleanField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["person", "company"], name="uniq_person_company"
            ),
            models.CheckConstraint(
                condition=models.Q(ended_on__isnull=True)
                | models.Q(started_on__isnull=True)
                | models.Q(ended_on__gte=models.F("started_on")),
                name="person_company_ends_after_it_starts",
            ),
        ]

    def __str__(self):
        return f"{self.person_id} @ {self.company_id}"

    def clean(self):
        # Catching the contradiction here rather than letting `is_past` silently
        # pick a winner: if someone ticks "still there" *and* gives a leaving
        # date in the past, only they know which they meant.
        if self.is_current and self.ended_on and self.ended_on <= timezone.localdate():
            raise ValidationError(
                {"is_current": "This says they still work here, but an end date has passed."}
            )

    @property
    def is_past(self):
        """Whether this contact has moved on from this company.

        Precedence, most explicit first: a leaving date that has arrived, then
        an explicit `is_current`, then "no idea, assume current". A future end
        date (someone on notice) still counts as current — they haven't gone yet.
        """
        if self.ended_on and self.ended_on <= timezone.localdate():
            return True
        if self.is_current is not None:
            return not self.is_current
        return False
