"""Deleting everything a user has tracked, without deleting the account.

Distinct from `backup.restore.wipe`, which clears only what a restore is
about to rewrite. This one is the Settings "delete all my data" action, so it
has to cover *every* user-scoped row — a leftover calendar event or education
entry after a supposed full delete is the kind of thing that destroys trust in
the button.

Shared reference data (companies, roles, industries, places) is deliberately
left alone: it isn't owned by any one user, and other accounts point at it.
"""

from django.db import transaction

from applications.models import Application, Resume
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import Person
from onboarding.models import SampleDataRecord
from todos.models import Todo

from .models import (
    Certification,
    Education,
    Experience,
    ExtraCurricular,
    ProfileAddress,
    ProfileLink,
)


@transaction.atomic
def purge_user_data(user):
    """Delete every row this user owns. Returns what was removed, per domain.

    Ordered so nothing is deleted out from under a PROTECTed foreign key:
    todos and catch-ups reference people and applications, so they go first.
    """
    counts = {}

    def drop(label, queryset):
        deleted, _ = queryset.delete()
        counts[label] = deleted

    drop("todos", Todo.objects.filter(user=user))
    drop("catchups", Catchup.objects.filter(user=user))
    drop("people", Person.objects.filter(user=user))
    drop("events", CalendarEvent.objects.filter(user=user))
    # Applications hold PROTECTed references to resumes, so they go first.
    drop("applications", Application.objects.filter(user=user))
    drop("resumes", Resume.objects.filter(user=user))
    drop("experiences", Experience.objects.filter(user=user))
    drop("education", Education.objects.filter(user=user))
    drop("certifications", Certification.objects.filter(user=user))
    drop("extracurriculars", ExtraCurricular.objects.filter(user=user))
    drop("links", ProfileLink.objects.filter(user=user))
    drop("addresses", ProfileAddress.objects.filter(user=user))
    # Tracking rows for sample data that has just been deleted along with
    # everything else — leaving these would strand the onboarding checklist.
    drop("sample_data", SampleDataRecord.objects.filter(user=user))

    return counts
