"""One account's link to Google Tasks.

Todos are mirrored one way — this app → Google — into a task list of their
own ("Career Tracker"), so the phone's calendar can show them without the
user's other Google tasks getting mixed in or overwritten.
"""

from django.conf import settings
from django.db import models


class GoogleTasksConnection(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="google_tasks_connection",
    )

    # Long-lived; blank until the consent step finishes. Its presence is what
    # "connected" means.
    refresh_token = models.TextField(blank=True)
    access_token = models.TextField(blank=True)
    access_token_expires_at = models.DateTimeField(null=True, blank=True)

    tasklist_id = models.CharField(max_length=255, blank=True)

    # Between "Connect" and Google sending the user back. The verifier is the
    # PKCE secret, kept here rather than in the `state` Google echoes back.
    pending_state = models.CharField(max_length=64, blank=True)
    pending_verifier = models.CharField(max_length=128, blank=True)
    pending_redirect_uri = models.CharField(max_length=255, blank=True)

    connected_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # The most recent failure, shown in Settings; cleared by the next success.
    last_error = models.TextField(blank=True)

    def __str__(self):
        return f"Google Tasks for {self.user_id}"

    @property
    def is_connected(self):
        return bool(self.refresh_token)
