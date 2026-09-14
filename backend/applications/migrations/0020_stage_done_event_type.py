# Generated manually for stage_done event type.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("applications", "0019_application_waiting_and_historical"),
    ]

    operations = [
        migrations.AlterField(
            model_name="appseventlog",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("created", "Created"),
                    ("stage", "Stage change"),
                    ("outcome", "Outcome change"),
                    ("edited", "Edited"),
                    ("waiting_started", "Waiting for response"),
                    ("waiting_ended", "Response received"),
                    ("stage_done", "Stage completed"),
                ],
                default="edited",
                max_length=20,
            ),
        ),
        migrations.RemoveConstraint(
            model_name="appseventlog",
            name="valid_event_type",
        ),
        migrations.AddConstraint(
            model_name="appseventlog",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "event_type__in",
                        [
                            "created",
                            "stage",
                            "outcome",
                            "edited",
                            "waiting_started",
                            "waiting_ended",
                            "stage_done",
                        ],
                    )
                ),
                name="valid_event_type",
            ),
        ),
    ]
