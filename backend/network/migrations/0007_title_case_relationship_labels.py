"""Title-case relationship preset: Industry contact → Industry Contact."""

from django.db import migrations


def retitle(apps, schema_editor):
    Tag = apps.get_model("network", "RelationshipTag")
    Tag.objects.filter(name="Industry contact").update(name="Industry Contact")


def revert(apps, schema_editor):
    Tag = apps.get_model("network", "RelationshipTag")
    Tag.objects.filter(name="Industry Contact").update(name="Industry contact")


class Migration(migrations.Migration):

    dependencies = [
        ("network", "0006_person_connections"),
    ]

    operations = [
        migrations.RunPython(retitle, revert),
    ]
