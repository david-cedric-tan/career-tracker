"""Title-case pipeline / outcome / event display labels.

Keys stay the same (`assessment_centre`, etc.) so existing rows are untouched;
only the human-facing names change. ApplicationStage presets are the live
source for stage pickers and bubble cards, so those rows are updated too.
"""

from django.db import migrations, models


STAGE_NAMES = {
    "not_submitted": "Not Submitted",
    "applied": "Applied",
    "online_assessment": "Online Assessment",
    "video_interview": "Video Interview",
    "assessment_centre": "Assessment Center",
    "final_interview": "Final Interview",
    "offer": "Offer",
}

STAGE_CHOICES = [
    ("not_submitted", "Not Submitted"),
    ("applied", "Applied"),
    ("online_assessment", "Online Assessment"),
    ("video_interview", "Video Interview"),
    ("assessment_centre", "Assessment Center"),
    ("final_interview", "Final Interview"),
    ("offer", "Offer"),
]

OUTCOME_CHOICES = [
    ("in_progress", "In Progress"),
    ("rejected", "Rejected"),
    ("offer_received", "Offer Received"),
    ("accepted", "Accepted"),
    ("declined", "Declined"),
    ("withdrawn", "Withdrawn"),
    ("ghosted", "Ghosted"),
]

EVENT_TYPE_CHOICES = [
    ("created", "Created"),
    ("stage", "Stage Change"),
    ("outcome", "Outcome Change"),
    ("edited", "Edited"),
    ("waiting_started", "Waiting For Response"),
    ("waiting_ended", "Response Received"),
    ("stage_done", "Stage Completed"),
]

ROLE_TYPE_CHOICES = [
    ("vacationer", "Vacationer / Internship"),
    ("graduate", "Graduate"),
    ("undergraduate", "Undergraduate"),
    ("side_job", "Side Job"),
]

WORK_ARRANGEMENT_CHOICES = [
    ("full_time", "Full-Time"),
    ("part_time", "Part-Time"),
    ("casual", "Casual"),
    ("contract", "Contract"),
]

RESUME_VARIANT_CHOICES = [
    ("general", "General"),
    ("company", "Company-Specific"),
    ("role", "Role-Specific"),
]


def retitle_stages(apps, schema_editor):
    Stage = apps.get_model("applications", "ApplicationStage")
    for key, name in STAGE_NAMES.items():
        Stage.objects.filter(key=key).update(name=name)


def revert_stages(apps, schema_editor):
    Stage = apps.get_model("applications", "ApplicationStage")
    old = {
        "not_submitted": "Not submitted",
        "applied": "Applied",
        "online_assessment": "Online assessment",
        "video_interview": "Video interview",
        "assessment_centre": "Assessment centre",
        "final_interview": "Final interview",
        "offer": "Offer",
    }
    for key, name in old.items():
        Stage.objects.filter(key=key).update(name=name)


class Migration(migrations.Migration):

    dependencies = [
        ("applications", "0020_stage_done_event_type"),
    ]

    operations = [
        migrations.RunPython(retitle_stages, revert_stages),
        migrations.AlterField(
            model_name="application",
            name="stage",
            field=models.CharField(
                choices=STAGE_CHOICES, default="applied", max_length=50
            ),
        ),
        migrations.AlterField(
            model_name="application",
            name="outcome",
            field=models.CharField(
                choices=OUTCOME_CHOICES, default="in_progress", max_length=50
            ),
        ),
        migrations.AlterField(
            model_name="applicationjoblisting",
            name="outcome",
            field=models.CharField(
                blank=True,
                choices=OUTCOME_CHOICES,
                help_text="Leave blank unless this role's result differs from the application.",
                max_length=50,
            ),
        ),
        migrations.AlterField(
            model_name="appseventlog",
            name="prev_stage",
            field=models.CharField(blank=True, choices=STAGE_CHOICES, max_length=50),
        ),
        migrations.AlterField(
            model_name="appseventlog",
            name="curr_stage",
            field=models.CharField(choices=STAGE_CHOICES, max_length=50),
        ),
        migrations.AlterField(
            model_name="appseventlog",
            name="prev_outcome",
            field=models.CharField(blank=True, choices=OUTCOME_CHOICES, max_length=50),
        ),
        migrations.AlterField(
            model_name="appseventlog",
            name="curr_outcome",
            field=models.CharField(choices=OUTCOME_CHOICES, max_length=50),
        ),
        migrations.AlterField(
            model_name="appseventlog",
            name="event_type",
            field=models.CharField(
                choices=EVENT_TYPE_CHOICES, default="edited", max_length=20
            ),
        ),
        migrations.AlterField(
            model_name="joblisting",
            name="role_type",
            field=models.CharField(
                blank=True, choices=ROLE_TYPE_CHOICES, max_length=50
            ),
        ),
        migrations.AlterField(
            model_name="joblisting",
            name="work_arrangement",
            field=models.CharField(
                blank=True, choices=WORK_ARRANGEMENT_CHOICES, max_length=50
            ),
        ),
        migrations.AlterField(
            model_name="resume",
            name="variant_type",
            field=models.CharField(
                choices=RESUME_VARIANT_CHOICES, default="general", max_length=20
            ),
        ),
    ]
