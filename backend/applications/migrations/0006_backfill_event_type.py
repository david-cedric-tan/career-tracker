"""Classify the rows written before `event_type` existed.

Every historical row was either a creation (no previous stage) or a
stage/outcome transition, so they can be labelled from their own columns
rather than being left on the `edited` default.
"""

from django.db import migrations
from django.db.models import F, Q


def backfill(apps, schema_editor):
    AppsEventLog = apps.get_model("applications", "AppsEventLog")

    AppsEventLog.objects.filter(prev_stage="").update(event_type="created")
    AppsEventLog.objects.exclude(prev_stage="").filter(
        ~Q(prev_stage=F("curr_stage"))
    ).update(event_type="stage")
    AppsEventLog.objects.exclude(prev_stage="").filter(
        prev_stage=F("curr_stage")
    ).update(event_type="outcome")


def noop(apps, schema_editor):
    """event_type is additive — rolling back just drops the column."""


class Migration(migrations.Migration):
    dependencies = [
        ("applications", "0005_appseventlog_changes_appseventlog_event_type_and_more"),
    ]

    operations = [migrations.RunPython(backfill, noop)]
