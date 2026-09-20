import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


def backfill_ticket_history(apps, schema_editor):
    """Seed a trail for tickets that existed before event logs did."""
    RefinementNote = apps.get_model("accounts", "RefinementNote")
    RefinementEventLog = apps.get_model("accounts", "RefinementEventLog")

    for note in RefinementNote.objects.all().iterator():
        RefinementEventLog.objects.create(
            note_id=note.id,
            event_type="raised",
            actor_id=note.user_id,
            created_at=note.created_at,
        )
        if note.resolution and note.resolved_at:
            RefinementEventLog.objects.create(
                note_id=note.id,
                event_type="fixed",
                detail=note.resolution,
                actor_id=note.resolved_by_id,
                created_at=note.resolved_at,
            )
        if note.status == "open" and note.resolution:
            # Best guess: they reopened after the fix. Stamp it after the fix.
            when = note.updated_at
            if note.resolved_at and when <= note.resolved_at:
                when = note.resolved_at
            RefinementEventLog.objects.create(
                note_id=note.id,
                event_type="reopened",
                actor_id=note.user_id,
                created_at=when,
            )
        elif (
            note.status == "done"
            and not note.resolution
            and note.updated_at != note.created_at
        ):
            RefinementEventLog.objects.create(
                note_id=note.id,
                event_type="closed",
                actor_id=note.user_id,
                created_at=note.updated_at,
            )


def drop_ticket_history(apps, schema_editor):
    apps.get_model("accounts", "RefinementEventLog").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0015_profile_pinned_photo"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RefinementEventLog",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("raised", "Raised"),
                            ("edited", "Edited"),
                            ("fixed", "Fixed"),
                            ("reopened", "Reopened"),
                            ("closed", "Closed"),
                        ],
                        max_length=20,
                    ),
                ),
                ("detail", models.TextField(blank=True)),
                (
                    "created_at",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="refinement_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "note",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="event_logs",
                        to="accounts.refinementnote",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at", "id"],
            },
        ),
        migrations.RunPython(backfill_ticket_history, drop_ticket_history),
    ]
