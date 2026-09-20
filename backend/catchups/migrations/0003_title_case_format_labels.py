"""Title-case catch-up format display labels."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catchups", "0002_catchup_format_other"),
    ]

    operations = [
        migrations.AlterField(
            model_name="catchup",
            name="format",
            field=models.CharField(
                choices=[
                    ("coffee", "Coffee / In Person"),
                    ("call", "Phone Call"),
                    ("video", "Video Call"),
                    ("event", "Event / Conference"),
                    ("message", "Messages"),
                    ("other", "Other"),
                ],
                default="coffee",
                max_length=20,
            ),
        ),
    ]
