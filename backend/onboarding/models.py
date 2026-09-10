"""Tracks sample rows created for a new user's tutorial, so the end-of-tour
checklist knows what to offer keeping and what to delete.

A generic relation rather than an `is_sample` flag on each domain model —
this is one small, isolated table instead of a migration on five different
apps (applications/todos/catchups/network/events) for a concern none of them
otherwise need to know about.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class SampleCategory(models.TextChoices):
    APPLICATION = "application", "Sample applications"
    TODO = "todo", "Sample todos"
    CATCHUP = "catchup", "Sample coffee chats"
    PERSON = "person", "Sample contact"
    EVENT = "event", "Sample calendar event"


class SampleDataRecord(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sample_data_records"
    )
    category = models.CharField(max_length=20, choices=SampleCategory.choices)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey("content_type", "object_id")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["category", "id"]
        indexes = [models.Index(fields=["user", "category"])]

    def __str__(self):
        return f"{self.category} sample for {self.user.username}"
