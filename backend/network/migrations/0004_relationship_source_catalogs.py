"""Converts Person.relationship and Person.source from fixed TextChoices to
real catalog tables (RelationshipTag, MetSourceTag) — addable, like
Company/Role/Industry already are, rather than a closed enum.

Structured as add-new-column -> backfill -> drop-old-column -> rename, all in
one migration, so the two FK columns exist under temporary names
(`relationship_fk`/`source_fk`) only for the data-migration step and the
model is left with the same `relationship`/`source` names it always had.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

RELATIONSHIP_LABELS = {
    "mentor": "Mentor",
    "alumni": "Alumni",
    "classmate": "Classmate",
    "colleague": "Colleague",
    "manager": "Manager",
    "recruiter": "Recruiter",
    "interviewer": "Interviewer",
    "industry_contact": "Industry contact",
    "academic": "Academic",
    "other": "Other",
}
SOURCE_LABELS = {
    "university_event": "University event",
    "professional_event": "Professional event",
    "internship": "Internship",
    "workplace": "Workplace",
    "class": "Class",
    "referral": "Referral",
    "linkedin": "LinkedIn",
    "other": "Other",
}


def seed_and_backfill(apps, schema_editor):
    Person = apps.get_model("network", "Person")
    RelationshipTag = apps.get_model("network", "RelationshipTag")
    MetSourceTag = apps.get_model("network", "MetSourceTag")

    relationship_tags = {}
    for label in dict.fromkeys(RELATIONSHIP_LABELS.values()):
        tag, _ = RelationshipTag.objects.get_or_create(name=label)
        relationship_tags[label] = tag

    source_tags = {}
    for label in dict.fromkeys(SOURCE_LABELS.values()):
        tag, _ = MetSourceTag.objects.get_or_create(name=label)
        source_tags[label] = tag

    other_relationship = relationship_tags["Other"]
    other_source = source_tags["Other"]

    for person in Person.objects.all():
        rel_label = RELATIONSHIP_LABELS.get(person.relationship, "Other")
        src_label = SOURCE_LABELS.get(person.source, "Other")
        person.relationship_fk_id = relationship_tags.get(rel_label, other_relationship).id
        person.source_fk_id = source_tags.get(src_label, other_source).id
        person.save(update_fields=["relationship_fk", "source_fk"])


def noop_reverse(apps, schema_editor):
    """Not reversible in any meaningful sense — the old fixed choices are
    gone from the codebase, so there is nothing to backfill the CharFields
    with beyond re-stringifying whatever tag each person ended up on."""


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("network", "0003_person_cadence_months"),
    ]

    operations = [
        migrations.CreateModel(
            name="RelationshipTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=50, unique=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="MetSourceTag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=50, unique=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.RemoveConstraint(model_name="person", name="valid_person_relationship"),
        migrations.RemoveConstraint(model_name="person", name="valid_person_source"),
        migrations.AddField(
            model_name="person",
            name="relationship_fk",
            field=models.ForeignKey(
                null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="people", to="network.relationshiptag",
            ),
        ),
        migrations.AddField(
            model_name="person",
            name="source_fk",
            field=models.ForeignKey(
                null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="people", to="network.metsourcetag",
            ),
        ),
        migrations.RunPython(seed_and_backfill, noop_reverse),
        migrations.RemoveField(model_name="person", name="relationship"),
        migrations.RemoveField(model_name="person", name="source"),
        migrations.RenameField(model_name="person", old_name="relationship_fk", new_name="relationship"),
        migrations.RenameField(model_name="person", old_name="source_fk", new_name="source"),
    ]
