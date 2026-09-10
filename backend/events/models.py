"""User-created calendar entries (FR-CAL-07).

Every other calendar row is *derived* — a todo's due date, an application's
follow-up. This is the one domain Calendar actually owns: an event that
doesn't correspond to anything else in the app, like "Career fair" or
"Coffee with a friend from uni".
"""

from django.conf import settings
from django.db import models

from applications.models import Application, Company
from network.models import Person


class CalendarEvent(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="calendar_events"
    )
    title = models.CharField(max_length=255)
    date = models.DateField()
    # `all_day=True` (the default, so existing rows stay exactly as they were)
    # means start_time/end_time are ignored; a timed event needs at least
    # start_time (end_time is optional — a duration-less event is fine).
    all_day = models.BooleanField(default=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # A plain personal reminder can be checked off, same as a todo.
    is_done = models.BooleanField(default=False)

    # What the event was actually about. All optional — a dentist appointment
    # links to nothing — but a careers fair is where you met three people, an
    # info session belongs to a company, and an assessment centre is a
    # by-product of an application reaching that stage. SET_NULL throughout:
    # the event still happened even if what it pointed at is gone.
    company = models.ForeignKey(
        Company, on_delete=models.SET_NULL, null=True, blank=True, related_name="events"
    )
    application = models.ForeignKey(
        Application, on_delete=models.SET_NULL, null=True, blank=True, related_name="events"
    )
    # "Where we met" — the people this event put you in a room with.
    people = models.ManyToManyField(Person, blank=True, related_name="events")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "id"]
        indexes = [models.Index(fields=["user", "date"])]

    def __str__(self):
        return self.title

    # All-day events have no start_time to count back from — 9am on the day
    # is the same convention Google Calendar's default all-day reminder uses.
    ALL_DAY_REMINDER_HOUR = 9

    @property
    def reference_time(self):
        """The clock time a reminder's `minutes_before` counts back from."""
        if not self.all_day and self.start_time:
            return self.start_time
        from datetime import time

        return time(self.ALL_DAY_REMINDER_HOUR, 0)


class EventReminder(models.Model):
    """How long before an event to alert — an event can carry several."""

    event = models.ForeignKey(CalendarEvent, on_delete=models.CASCADE, related_name="reminders")
    minutes_before = models.PositiveIntegerField()

    class Meta:
        ordering = ["minutes_before"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "minutes_before"], name="uniq_reminder_per_event"
            )
        ]

    def __str__(self):
        return f"{self.minutes_before}m before {self.event.title}"
