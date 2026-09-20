"""Meeting minutes for network catch-ups (FR-CATCH-*).

`Person.last_meeting_at` records *when* you last spoke. This records *what was
said* — one row per meeting, with minutes you can go back to before the next one.
"""

from django.conf import settings
from django.db import models

from network.models import Person


class CatchupFormat(models.TextChoices):
    COFFEE = "coffee", "Coffee / In Person"
    CALL = "call", "Phone Call"
    VIDEO = "video", "Video Call"
    EVENT = "event", "Event / Conference"
    MESSAGE = "message", "Messages"
    OTHER = "other", "Other"


class Catchup(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="catchups"
    )
    person = models.ForeignKey(
        Person, on_delete=models.CASCADE, related_name="catchups"
    )

    met_on = models.DateField()
    title = models.CharField(max_length=255, blank=True)
    format = models.CharField(
        max_length=20, choices=CatchupFormat.choices, default=CatchupFormat.COFFEE
    )
    # Only meaningful when format == OTHER — what "other" actually was.
    format_other = models.CharField(max_length=100, blank=True)
    # Only meaningful when format == MESSAGE — which channel the message went
    # through. Feeds Person.last_message_channel.
    message_channel = models.CharField(max_length=20, blank=True)
    location = models.CharField(max_length=255, blank=True)

    minutes = models.TextField(blank=True)
    takeaways = models.TextField(blank=True)
    follow_up_on = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-met_on", "-created_at"]
        indexes = [
            models.Index(fields=["user", "met_on"]),
            models.Index(fields=["person", "met_on"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(format__in=[c[0] for c in CatchupFormat.choices]),
                name="valid_catchup_format",
            ),
            # FR-CATCH-09 — a follow-up can't be scheduled before the meeting.
            models.CheckConstraint(
                condition=models.Q(follow_up_on__isnull=True)
                | models.Q(follow_up_on__gte=models.F("met_on")),
                name="followup_not_before_meeting",
            ),
        ]

    def __str__(self):
        return f"{self.person.full_name} — {self.met_on}"

    @property
    def display_format(self):
        """"Other" alone says nothing — show what the user actually typed."""
        if self.format == CatchupFormat.OTHER and self.format_other:
            return self.format_other
        return self.get_format_display()

    @property
    def display_title(self):
        """Falls back to the format so a title-less row still reads sensibly."""
        return self.title or self.display_format
