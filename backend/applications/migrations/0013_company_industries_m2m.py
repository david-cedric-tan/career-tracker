"""Company.industry (a single FK) -> Company.industries (M2M) — a company can
genuinely belong to more than one industry, the same reasoning `regions`
already uses. Structured add-M2M -> backfill -> drop-FK, so the old single
value survives as the M2M's one starting entry rather than being dropped.
"""

from django.db import migrations, models


def backfill(apps, schema_editor):
    Company = apps.get_model("applications", "Company")
    for company in Company.objects.exclude(industry__isnull=True):
        company.industries.add(company.industry_id)


def noop_reverse(apps, schema_editor):
    """Not reversible: a company with several industries has no single
    "the" industry to fall back the FK column to."""


class Migration(migrations.Migration):
    dependencies = [
        ("applications", "0012_companynote"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="industries",
            field=models.ManyToManyField(blank=True, related_name="companies", to="applications.industry"),
        ),
        migrations.RunPython(backfill, noop_reverse),
        migrations.RemoveField(model_name="company", name="industry"),
    ]
