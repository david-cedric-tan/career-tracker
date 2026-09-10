"""Seed a handful of sample rows for a brand-new account to explore during
the onboarding tour, and clean them up afterwards by the categories the user
actually wants to keep.

Deliberately small and self-contained rather than reusing `seed_demo` (that
command builds a large, realistic demo account on purpose — this needs just
enough in each domain to not be empty during the tour).
"""

from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.utils import timezone

from applications.models import Application, Company, Outcome, Stage
from catchups.models import Catchup, CatchupFormat
from events.models import CalendarEvent
from network.models import MetSourceTag, Person, PersonStatus, RelationshipTag
from todos.models import Priority, Todo, TodoStatus

from .models import SampleCategory, SampleDataRecord

SAMPLE_COMPANY_NAME = "Aurora Digital (Sample)"


def _track(user, category, obj):
    SampleDataRecord.objects.create(
        user=user,
        category=category,
        content_type=ContentType.objects.get_for_model(obj),
        object_id=obj.pk,
    )


@transaction.atomic
def seed_sample_data(user):
    """Idempotent — a user who already has sample rows (or has completed
    onboarding once already) doesn't get a second set on a replay."""
    if SampleDataRecord.objects.filter(user=user).exists():
        return

    today = timezone.localdate()

    company, _ = Company.objects.get_or_create(name=SAMPLE_COMPANY_NAME)

    application = Application.objects.create(
        user=user,
        company=company,
        stage=Stage.APPLIED,
        outcome=Outcome.IN_PROGRESS,
        applied_at=today,
        source="Sample data",
        notes="This is a sample application to explore — edit it, move its "
        "stage, or open its history. You'll be asked whether to keep it "
        "once the tour finishes.",
    )
    _track(user, SampleCategory.APPLICATION, application)

    todo = Todo.objects.create(
        user=user,
        title="Follow up after the online assessment (sample)",
        description="A sample todo — try checking it off or editing its due date.",
        due_date=today + timedelta(days=2),
        priority=Priority.MEDIUM,
        status=TodoStatus.OPEN,
    )
    _track(user, SampleCategory.TODO, todo)

    recruiter_tag, _ = RelationshipTag.objects.get_or_create(name="Recruiter")
    referral_tag, _ = MetSourceTag.objects.get_or_create(name="Referral")
    person = Person.objects.create(
        user=user,
        full_name="Jamie Rivera (Sample Contact)",
        title="Graduate Recruiter",
        status=PersonStatus.CONNECTION,
        relationship=recruiter_tag,
        source=referral_tag,
        next_chat_at=today + timedelta(days=7),
    )
    catchup = Catchup.objects.create(
        user=user,
        person=person,
        met_on=today - timedelta(days=3),
        title="Coffee chat (sample)",
        format=CatchupFormat.COFFEE,
        minutes="Discussed the graduate program timeline and what stands out in an application.",
        takeaways="Follow up in a week with a thank-you note.",
        follow_up_on=today + timedelta(days=4),
    )
    _track(user, SampleCategory.CATCHUP, person)
    _track(user, SampleCategory.CATCHUP, catchup)

    event = CalendarEvent.objects.create(
        user=user,
        title="Career fair (sample event)",
        date=today + timedelta(days=5),
        all_day=True,
        notes="A sample calendar entry — try editing it, or adding a reminder.",
    )
    _track(user, SampleCategory.EVENT, event)


def sample_data_summary(user):
    """One row per category still present, with a count and a couple of
    example titles — enough for the end-of-tour checklist to describe what
    each keep/discard choice actually affects."""
    records = SampleDataRecord.objects.filter(user=user).select_related("content_type")
    by_category = {}
    for record in records:
        obj = record.content_object
        if obj is None:
            continue
        label = getattr(obj, "title", None) or getattr(obj, "full_name", None) or str(obj)
        entry = by_category.setdefault(record.category, {"count": 0, "examples": []})
        entry["count"] += 1
        if len(entry["examples"]) < 2:
            entry["examples"].append(label)

    return [
        {
            "category": category,
            "label": SampleCategory(category).label,
            "count": data["count"],
            "examples": data["examples"],
        }
        for category, data in by_category.items()
    ]


@transaction.atomic
def cleanup_sample_data(user, keep_categories):
    """Deletes every tracked sample row whose category isn't in
    `keep_categories`, then clears all tracking either way — kept rows just
    become ordinary data at that point, nothing left to track."""
    keep = set(keep_categories)
    records = list(SampleDataRecord.objects.filter(user=user).select_related("content_type"))

    for record in records:
        if record.category in keep:
            continue
        obj = record.content_object
        if obj is not None:
            obj.delete()

    # The sample company is reference data, not a tracked row itself — drop
    # it too, but only if nothing (kept or otherwise) still points at it.
    company = Company.objects.filter(name=SAMPLE_COMPANY_NAME).first()
    if company and not company.applications.exists():
        company.delete()

    SampleDataRecord.objects.filter(user=user).delete()
