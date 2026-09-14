"""Title-case profile link category display labels."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0017_refinement_workflow_statuses"),
    ]

    operations = [
        migrations.AlterField(
            model_name="profilelink",
            name="category",
            field=models.CharField(
                choices=[
                    ("portfolio", "Portfolio"),
                    ("github", "GitHub"),
                    ("website", "Personal Site"),
                    ("social", "Social"),
                    ("other", "Other"),
                ],
                default="other",
                max_length=20,
            ),
        ),
    ]
