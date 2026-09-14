from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_refinement_event_log"),
    ]

    operations = [
        migrations.AlterField(
            model_name="refinementnote",
            name="status",
            field=models.CharField(
                choices=[
                    ("open", "Open"),
                    ("testing", "Testing"),
                    ("awaiting_validation", "Awaiting validation"),
                    ("done", "Done"),
                ],
                default="open",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="refinementeventlog",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("raised", "Raised"),
                    ("edited", "Edited"),
                    ("fixed", "Fixed"),
                    ("reopened", "Reopened"),
                    ("closed", "Closed"),
                    ("testing", "Testing"),
                    ("awaiting_validation", "Awaiting validation"),
                ],
                max_length=20,
            ),
        ),
    ]
