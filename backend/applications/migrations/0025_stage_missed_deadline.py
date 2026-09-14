"""Add Missed Deadline as a pipeline stage preset, immediately after Offer.

Also remains an outcome (see 0024). Current bubbles group by *stage*, so this
row is what makes a Missed Deadline ring appear after Offer — custom stages
still insert just before it (the last preset).
"""

from django.db import migrations
from django.db.models import F


def seed_missed_deadline_stage(apps, schema_editor):
    Stage = apps.get_model("applications", "ApplicationStage")

    offer = Stage.objects.filter(key="offer").first()
    # Right after Offer when the preset exists; otherwise append at the end.
    target = (offer.position + 1) if offer is not None else (
        (Stage.objects.order_by("-position", "-id").first().position + 1)
        if Stage.objects.exists()
        else 0
    )

    existing = Stage.objects.filter(key="missed_deadline").first()
    if existing:
        if existing.position != target:
            # Make room, then park it after Offer.
            Stage.objects.filter(position__gte=target).exclude(pk=existing.pk).update(
                position=F("position") + 1
            )
            existing.position = target
        existing.name = "Missed Deadline"
        existing.is_preset = True
        existing.save(update_fields=["name", "is_preset", "position"])
        return

    Stage.objects.filter(position__gte=target).update(position=F("position") + 1)
    Stage.objects.create(
        key="missed_deadline",
        name="Missed Deadline",
        position=target,
        is_preset=True,
    )


def drop_missed_deadline_stage(apps, schema_editor):
    Stage = apps.get_model("applications", "ApplicationStage")
    Stage.objects.filter(key="missed_deadline", is_preset=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("applications", "0024_outcome_missed_deadline"),
    ]

    operations = [
        migrations.RunPython(seed_missed_deadline_stage, drop_missed_deadline_stage),
    ]
