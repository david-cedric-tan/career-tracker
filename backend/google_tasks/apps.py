from django.apps import AppConfig


class GoogleTasksConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "google_tasks"

    def ready(self):
        from . import signals  # noqa: F401 — connects the todo receivers
