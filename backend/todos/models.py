"""Personal task list (FR-TODO-*).

A todo can stand alone or hang off an application, a person, or a company —
three optional FKs rather than a generic relation, so the DB keeps referential
integrity and the dashboard can join cheaply.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from applications.models import Application, Company
from network.models import Person


class TodoStatus(models.TextChoices):
    OPEN = "open", "Open"
    DONE = "done", "Done"
    CANCELLED = "cancelled", "Cancelled"


class Priority(models.TextChoices):
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"


class Todo(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="todos"
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    due_date = models.DateField(null=True, blank=True)
    # Optional clock time on the due date. Null means all-day (the previous
    # behaviour); set when the task belongs on a specific hour of the calendar.
    due_time = models.TimeField(null=True, blank=True)
    # Optional end of a timed block. Null with a due_time means the calendar
    # treats it as one hour; set to model longer blocks (OA, interview, etc.).
    due_end_time = models.TimeField(null=True, blank=True)
    priority = models.CharField(
        max_length=10, choices=Priority.choices, default=Priority.MEDIUM
    )
    status = models.CharField(
        max_length=12, choices=TodoStatus.choices, default=TodoStatus.OPEN
    )

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, null=True, blank=True,
        related_name="todos",
    )
    person = models.ForeignKey(
        Person, on_delete=models.CASCADE, null=True, blank=True, related_name="todos"
    )
    company = models.ForeignKey(
        Company, on_delete=models.SET_NULL, null=True, blank=True, related_name="todos"
    )

    # Manual order, used only by the "Custom" sort. Every other sort ignores
    # it, so dragging a list into shape doesn't fight due dates or priority —
    # it's a separate view of the same todos.
    position = models.PositiveIntegerField(default=0)

    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "due_date", "-priority"]
        indexes = [
            models.Index(fields=["user", "status", "due_date"]),
            models.Index(fields=["completed_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=[c[0] for c in TodoStatus.choices]),
                name="valid_todo_status",
            ),
            models.CheckConstraint(
                condition=models.Q(priority__in=[c[0] for c in Priority.choices]),
                name="valid_todo_priority",
            ),
            # FR-TODO-03 — a done todo always carries its completion stamp,
            # and an open one never does.
            models.CheckConstraint(
                condition=(
                    models.Q(status="done", completed_at__isnull=False)
                    | ~models.Q(status="done")
                ),
                name="done_todo_has_completed_at",
            ),
        ]

    def __str__(self):
        return self.title

    @property
    def is_overdue(self):
        if self.status != TodoStatus.OPEN or self.due_date is None:
            return False
        today = timezone.localdate()
        if self.due_date < today:
            return True
        if self.due_date > today or self.due_time is None:
            return False
        return self.due_time < timezone.localtime().time()

    def sync_completion(self):
        """Keep `completed_at` in step with `status` (FR-TODO-03)."""
        if self.status == TodoStatus.DONE and self.completed_at is None:
            self.completed_at = timezone.now()
        elif self.status != TodoStatus.DONE:
            self.completed_at = None
        return self.completed_at
