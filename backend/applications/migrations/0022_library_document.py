"""Introduce LibraryDocument and migrate ApplicationDocument rows into it."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def copy_documents(apps, schema_editor):
    ApplicationDocument = apps.get_model("applications", "ApplicationDocument")
    LibraryDocument = apps.get_model("applications", "LibraryDocument")
    for doc in ApplicationDocument.objects.select_related("application").all():
        library = LibraryDocument(
            user_id=doc.application.user_id,
            application_id=doc.application_id,
            title=doc.title,
            description=doc.description,
            original_name=doc.original_name,
            kind=doc.kind,
            tags=[],
            position=doc.position,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )
        # Reuse the stored path so files are not duplicated or lost.
        if doc.file:
            library.file.name = doc.file.name
        library.save()


def noop_reverse(apps, schema_editor):
    # Files now live only on LibraryDocument; reverse would drop them.
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("applications", "0021_title_case_display_labels"),
    ]

    operations = [
        migrations.CreateModel(
            name="LibraryDocument",
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
                ("file", models.FileField(upload_to="library_documents/")),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
                ("original_name", models.CharField(blank=True, max_length=255)),
                ("kind", models.CharField(max_length=10)),
                ("tags", models.JSONField(blank=True, default=list)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "application",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="library_documents",
                        to="applications.application",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="library_documents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["position", "id"],
            },
        ),
        migrations.RunPython(copy_documents, noop_reverse),
        migrations.DeleteModel(name="ApplicationDocument"),
    ]
