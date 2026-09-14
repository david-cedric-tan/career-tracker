"""Read-only aggregation across applications, network and todos (FR-DASH-*).

NFR-03: this layer owns no write truth. Every number here is derived from the
domain tables — the event log in particular (FR-LOG-05) is what makes the time
series honest, since it records when a transition happened rather than only
the application's current state.
"""

from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, F, Min, Q
from django.db.models.functions import TruncMonth, TruncQuarter
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from applications.serializers import application_deadline, stage_label
from applications.models import (
    Application,
    ApplicationStage,
    AppsEventLog,
    CompanyNote,
    EventType,
    Outcome,
    Stage,
)
from catchups.models import Catchup, CatchupFormat
from events.models import CalendarEvent
from network.models import Person, PersonStatus
from todos.models import Todo, TodoStatus


def _period(request):
    """`all` (default), `month` or `quarter` — FR-DASH-06.

    Weeks were the finest grain here and turned out to be the wrong one: a
    graduate hiring cycle moves over seasons, so a weekly chart was mostly
    empty buckets with the occasional spike, which reads as noise rather than
    as a trend.
    """
    value = request.query_params.get("period", "all")
    return value if value in {"month", "quarter", "all"} else "all"


def _window_start(period, today):
    """The earliest date the dashboard's period covers, or None for all time.

    Matched to what the trend chart draws, so the counters and the chart are
    always describing the same stretch of time — a summary that silently
    counted everything while the chart showed a year would make the two
    disagree for no visible reason.
    """
    if period == "all":
        return None
    return _step_back_months(today, 24 if period == "quarter" else 12)


def _step_back_months(today, months):
    """The first of the month `months` before `today`."""
    year, month = today.year, today.month - months
    while month <= 0:
        month += 12
        year -= 1
    return today.replace(year=year, month=month, day=1)


def _bucket_starts(period, buckets, today):
    """Every bucket start in range, so empty months render as zeros not gaps."""
    step = 3 if period == "quarter" else 1
    if period == "quarter":
        # Snap to the quarter this date falls in, so buckets line up with
        # calendar quarters rather than counting back from an arbitrary month.
        today = today.replace(month=((today.month - 1) // 3) * 3 + 1, day=1)
    return [
        _step_back_months(today, index * step) for index in range(buckets - 1, -1, -1)
    ]


def _trunc(period):
    return TruncQuarter if period == "quarter" else TruncMonth


def stage_rows():
    """The pipeline in order. Read per request, not cached at import: stages
    are addable now, so a module-level snapshot would miss any that were added
    after the process started."""
    return list(ApplicationStage.objects.all())


def stage_rank():
    """A stage's position in the real pipeline order, so "how much progress
    did this move represent" can be measured instead of just "did a move
    happen". Keyed on the stored stage key, including any custom ones."""
    return {row.key: index for index, row in enumerate(stage_rows())}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def summary(request):
    """FR-DASH-01 / 03 / 04 — the headline counters."""
    user = request.user
    today = timezone.localdate()
    soon = today + timedelta(days=7)

    applications = Application.objects.filter(user=user)
    period = _period(request)
    since = _window_start(period, today)
    if since is not None:
        applications = applications.filter(applied_at__gte=since)
    stages = stage_rows()
    stage_counts = dict(
        applications.values_list("stage").annotate(n=Count("id")).values_list("stage", "n")
    )
    # Rejections keep the stage they got to, so this reads as "where do things
    # fall over" rather than just how many died overall.
    stage_rejections = dict(
        applications.filter(outcome=Outcome.REJECTED)
        .values_list("stage")
        .annotate(n=Count("id"))
        .values_list("stage", "n")
    )
    # Where the ball is in their court right now — the same state the
    # applications list flags amber, counted per stage.
    stage_awaiting = dict(
        applications.filter(awaiting_response=True)
        .values_list("stage")
        .annotate(n=Count("id"))
        .values_list("stage", "n")
    )
    outcome_counts = dict(
        applications.values_list("outcome")
        .annotate(n=Count("id"))
        .values_list("outcome", "n")
    )

    todos = Todo.objects.filter(user=user)
    people = Person.objects.filter(user=user)

    return Response(
        {
            "period": period,
            "applications": {
                "total": applications.count(),
                "active": applications.filter(outcome=Outcome.IN_PROGRESS).count(),
                "offers": applications.filter(
                    outcome__in=[Outcome.OFFER_RECEIVED, Outcome.ACCEPTED]
                ).count(),
                "rejected": applications.filter(outcome=Outcome.REJECTED).count(),
                "follow_ups_due": applications.filter(
                    follow_up_date__isnull=False,
                    follow_up_date__lte=today,
                    outcome=Outcome.IN_PROGRESS,
                ).count(),
                # Zero-filled so the pipeline chart always shows every stage.
                "by_stage": [
                    {
                        "value": value,
                        "label": label,
                        "count": stage_counts.get(value, 0),
                        "rejected": stage_rejections.get(value, 0),
                        "awaiting": stage_awaiting.get(value, 0),
                    }
                    for value, label in [(row.key, row.name) for row in stages]
                ],
                "by_outcome": [
                    {
                        "value": value,
                        "label": label,
                        "count": outcome_counts.get(value, 0),
                    }
                    for value, label in Outcome.choices
                ],
            },
            "todos": {
                "open": todos.filter(status=TodoStatus.OPEN).count(),
                "done": todos.filter(status=TodoStatus.DONE).count(),
                "overdue": todos.filter(
                    status=TodoStatus.OPEN, due_date__lt=today
                ).count(),
                "due_this_week": todos.filter(
                    status=TodoStatus.OPEN, due_date__gte=today, due_date__lte=soon
                ).count(),
            },
            "network": {
                "total": people.count(),
                "connections": people.filter(status=PersonStatus.CONNECTION).count(),
                "leads": people.filter(status=PersonStatus.LEAD).count(),
                "chats_overdue": people.filter(next_chat_at__lt=today)
                .exclude(status__in=[PersonStatus.ARCHIVED, PersonStatus.GHOSTED])
                .count(),
                "chats_due_soon": people.filter(
                    next_chat_at__gte=today, next_chat_at__lte=soon
                )
                .exclude(status__in=[PersonStatus.ARCHIVED, PersonStatus.GHOSTED])
                .count(),
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timeseries(request):
    """FR-DASH-02 / 03 — applications, stage advances and todos per bucket."""
    user = request.user
    period = _period(request)
    try:
        buckets = min(max(int(request.query_params.get("buckets", 12)), 2), 52)
    except (TypeError, ValueError):
        buckets = 12

    today = timezone.localdate()
    if period == "all":
        # "All" has no fixed length — it runs from the first thing logged to
        # now, and drops to quarters once a monthly chart would be too dense
        # to read.
        earliest = Application.objects.filter(user=user).aggregate(
            first=Min("applied_at")
        )["first"] or today
        months = (today.year - earliest.year) * 12 + (today.month - earliest.month) + 1
        grain = "quarter" if months > 24 else "month"
        span = months if grain == "month" else (months + 2) // 3
        buckets = min(max(span, 2), 52)
    else:
        grain = period

    starts = _bucket_starts(grain, buckets, today)
    since = starts[0]
    trunc = _trunc(grain)

    def zeroed():
        return {start.isoformat(): 0 for start in starts}

    applied = zeroed()
    rows = (
        Application.objects.filter(user=user, applied_at__gte=since)
        .annotate(bucket=trunc("applied_at"))
        .values("bucket")
        .annotate(n=Count("id"))
    )
    for row in rows:
        key = row["bucket"].isoformat()
        if key in applied:
            applied[key] = row["n"]

    # FR-LOG-05 — stage movement comes from the append-only log, not from the
    # applications' current stage, which has no history of its own.
    #
    # Weighted by pipeline position, not a flat count per transition: a jump
    # straight from Applied to Final Interview is real progress an ordinary
    # Applied -> OA move isn't, and counting both as "1 advance" flattened
    # that out. Each row contributes how many pipeline steps it actually
    # covered (curr rank - prev rank); a backward or lateral move (a
    # correction, or an outcome-only edit that still carries prev_stage
    # unchanged) contributes nothing rather than a negative dent in the chart.
    advances = zeroed()
    ranks = stage_rank()
    rows = (
        AppsEventLog.objects.filter(
            application__user=user, changed_at__date__gte=since
        )
        .exclude(prev_stage="")
        .exclude(prev_stage=F("curr_stage"))
        .annotate(bucket=trunc("changed_at"))
        .values("bucket", "prev_stage", "curr_stage")
    )
    for row in rows:
        key = row["bucket"].date().isoformat()
        if key not in advances:
            continue
        prev_rank = ranks.get(row["prev_stage"])
        curr_rank = ranks.get(row["curr_stage"])
        if prev_rank is None or curr_rank is None:
            continue
        delta = curr_rank - prev_rank
        if delta > 0:
            advances[key] += delta

    completed = zeroed()
    rows = (
        Todo.objects.filter(
            user=user, status=TodoStatus.DONE, completed_at__date__gte=since
        )
        .annotate(bucket=trunc("completed_at"))
        .values("bucket")
        .annotate(n=Count("id"))
    )
    for row in rows:
        key = row["bucket"].date().isoformat()
        if key in completed:
            completed[key] = row["n"]

    return Response(
        {
            "period": period,
            # What the buckets actually are — "all" resolves to one or the
            # other, and the axis labels need to know which.
            "grain": grain,
            "buckets": [
                {
                    "start": start.isoformat(),
                    "applications": applied[start.isoformat()],
                    "stage_advances": advances[start.isoformat()],
                    "todos_completed": completed[start.isoformat()],
                }
                for start in starts
            ],
        }
    )


def _change_phrase(changes):
    """"notes", "notes and follow-up", "notes, follow-up and 2 more"."""
    labels = [change["label"].lower() for change in changes]
    if not labels:
        return "details"
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return f"{labels[0]}, {labels[1]} and {len(labels) - 2} more"


def _change_detail(log):
    """Secondary line for a transition that also carried field edits."""
    if log.event_type != EventType.EDITED and log.changes:
        return f"Also updated {_change_phrase(log.changes)}."
    return ""


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def activity(request):
    """FR-DASH-05 / 07 — one merged feed with links back to each record.

    Query-time union rather than a materialised ActivityEvent table
    (FR-DASH-08); at personal-tracker volume this is cheap and keeps the
    domains as the single source of truth.
    """
    user = request.user
    try:
        limit = min(max(int(request.query_params.get("limit", 25)), 1), 100)
    except (TypeError, ValueError):
        limit = 25

    items = []

    for log in (
        AppsEventLog.objects.filter(application__user=user)
        .select_related("application", "application__company")
        .order_by("-changed_at")[:limit]
    ):
        company = log.application.company.display_name

        if log.event_type == EventType.STAGE:
            summary_text = (
                f"{company}: {log.get_prev_stage_display()} → "
                f"{log.get_curr_stage_display()}"
            )
        elif log.event_type == EventType.OUTCOME:
            summary_text = f"{company}: marked {log.get_curr_outcome_display()}"
        elif log.event_type == EventType.EDITED:
            summary_text = f"{company}: updated {_change_phrase(log.changes)}"
        else:
            summary_text = f"Applied to {company}"

        items.append(
            {
                "domain": "application",
                "event_type": log.event_type,
                "occurred_at": log.changed_at.isoformat(),
                "summary": summary_text,
                # A stage move that also touched other fields says so. The
                # user's own note doesn't suppress that — both are shown.
                "note": " · ".join(
                    part for part in [log.note.strip(), _change_detail(log)] if part
                ),
                "target_id": log.application_id,
                "target_url": f"/applications/{log.application_id}",
            }
        )

    for todo in (
        Todo.objects.filter(user=user, status=TodoStatus.DONE, completed_at__isnull=False)
        .order_by("-completed_at")[:limit]
    ):
        items.append(
            {
                "domain": "todo",
                "event_type": "completed",
                "occurred_at": todo.completed_at.isoformat(),
                "summary": f"Completed “{todo.title}”",
                "note": "",
                "target_id": todo.id,
                "target_url": "/todos",
            }
        )

    for catchup in (
        Catchup.objects.filter(user=user)
        .select_related("person")
        .order_by("-met_on", "-created_at")[:limit]
    ):
        items.append(
            {
                "domain": "catchup",
                "event_type": "catchup",
                # Catch-ups are dated by the meeting, not by when they were
                # typed up, so a backfilled minute lands in the right place.
                "occurred_at": catchup.created_at.isoformat(),
                "summary": f"Caught up with {catchup.person.full_name}",
                "note": catchup.display_title,
                "target_id": catchup.id,
                "target_url": f"/catchups/{catchup.id}",
            }
        )

    for person in Person.objects.filter(user=user).order_by("-created_at")[:limit]:
        items.append(
            {
                "domain": "network",
                "event_type": "person_added",
                "occurred_at": person.created_at.isoformat(),
                "summary": f"Added {person.full_name} to your network",
                "note": person.title,
                "target_id": person.id,
                "target_url": f"/network/{person.id}",
            }
        )

    items.sort(key=lambda item: item["occurred_at"], reverse=True)
    return Response(items[:limit])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def companies(request):
    """FR-DASH-09..11 — every company the user has applied to, with counts.

    Ordered so the panel reads as "where do things actually stand": offers
    first, then live applications ranked by how far through the pipeline they
    are, then everything closed, and finally the companies that only ever
    rejected you. Within a band, the most recently applied-to company leads.

    The stage ranking comes from `ApplicationStage.position` rather than a
    hardcoded list, because stages are user-addable and reorderable — a
    pipeline someone rearranged should rank by *their* order, not ours.
    """
    stage_positions = dict(ApplicationStage.objects.values_list("key", "position"))

    # Scoped to the same window as the rest of the dashboard, so the panel
    # lists the companies behind the numbers beside it rather than every
    # company you've ever applied to.
    today = timezone.localdate()
    rows = Application.objects.filter(user=request.user).annotate(
        # The soonest closing date across the listings this application
        # covers — the one that actually constrained it.
        deadline=Min("listing_links__job_listing__closing_at")
    )
    since = _window_start(_period(request), today)
    if since is not None:
        rows = rows.filter(applied_at__gte=since)

    tally = {}
    for row in rows.values(
        "company_id",
        "company__name",
        "company__short_name",
        "company__logo",
        "outcome",
        "stage",
        "applied_at",
        "awaiting_response",
        "deadline",
    ):
        entry = tally.get(row["company_id"])
        if entry is None:
            entry = {
                "id": row["company_id"],
                "name": row["company__name"],
                "short_name": row["company__short_name"] or "",
                "logo": row["company__logo"],
                "count": 0,
                "active": 0,
                "offers": 0,
                "rejected": 0,
                # Live applications where the ball is in their court.
                "waiting": 0,
                # Closing dates that went by unanswered.
                "missed": 0,
                "stage_rank": -1,
                "last_applied": None,
            }
            tally[row["company_id"]] = entry

        entry["count"] += 1
        # Either you said so outright, or the listing shut while it was still
        # sitting unsubmitted — both are the same missed chance.
        if row["stage"] == Stage.MISSED_DEADLINE or (
            row["stage"] == Stage.NOT_SUBMITTED
            and row["outcome"] == Outcome.IN_PROGRESS
            and row["deadline"] is not None
            and row["deadline"] < today
        ):
            entry["missed"] += 1
        if row["outcome"] == Outcome.IN_PROGRESS:
            entry["active"] += 1
            if row["awaiting_response"]:
                entry["waiting"] += 1
            # Only live applications set the stage rank — how far a rejected
            # application got is history, not where the company stands now.
            entry["stage_rank"] = max(
                entry["stage_rank"], stage_positions.get(row["stage"], 0)
            )
        elif row["outcome"] in (Outcome.OFFER_RECEIVED, Outcome.ACCEPTED):
            entry["offers"] += 1
        elif row["outcome"] == Outcome.REJECTED:
            entry["rejected"] += 1

        entry["last_applied"] = (
            row["applied_at"]
            if entry["last_applied"] is None
            else max(entry["last_applied"], row["applied_at"])
        )

    def band(entry):
        if entry["offers"]:
            return 0
        if entry["active"]:
            return 1
        # Nothing but rejections goes to the very end; a company that merely
        # ghosted or that you withdrew from still ranks above that.
        if entry["rejected"] == entry["count"]:
            return 3
        return 2

    ordered = sorted(
        tally.values(),
        key=lambda entry: (
            band(entry),
            -entry["stage_rank"],
            -entry["last_applied"].toordinal(),
            entry["name"].lower(),
        ),
    )

    return Response(
        [
            {
                "id": entry["id"],
                "name": entry["name"],
                "short_name": entry["short_name"],
                "logo": (
                    request.build_absolute_uri(f"{settings.MEDIA_URL}{entry['logo']}")
                    if entry["logo"]
                    else None
                ),
                "count": entry["count"],
                "active": entry["active"],
                "waiting": entry["waiting"],
                "missed": entry["missed"],
                "offers": entry["offers"],
                "rejected": entry["rejected"],
            }
            for entry in ordered
        ]
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def regions(request):
    """Applications by region, for the dashboard's map widget.

    Reads each application's company's tagged `regions` (Company.regions, a
    country tag set by Job Directory) rather than a job listing's location —
    a listing's precise city is often left blank, so the company-level tag is
    the reliable source here. An application whose company has no region tag
    just doesn't contribute a row.
    """
    rows = (
        Application.objects.filter(user=request.user)
        .exclude(company__regions__isnull=True)
        .values("company__regions", "company__regions__name")
        .annotate(count=Count("id", distinct=True))
        .order_by("-count")
    )

    return Response(
        [
            {
                "country_id": row["company__regions"],
                "country_name": row["company__regions__name"],
                "count": row["count"],
            }
            for row in rows
        ]
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attention(request):
    """What needs doing right now — drives the dashboard's action list."""
    user = request.user
    today = timezone.localdate()
    horizon = today + timedelta(days=7)

    follow_ups = [
        {
            "id": app.id,
            "company": app.company.display_name,
            "stage": app.get_stage_display(),
            "follow_up_date": app.follow_up_date,
        }
        for app in Application.objects.filter(
            user=user,
            outcome=Outcome.IN_PROGRESS,
            follow_up_date__isnull=False,
            follow_up_date__lte=horizon,
        ).select_related("company").order_by("follow_up_date")[:10]
    ]

    chats = [
        {
            "id": person.id,
            "full_name": person.full_name,
            "next_chat_at": person.next_chat_at,
            "status": person.get_status_display(),
        }
        for person in Person.objects.filter(
            user=user, next_chat_at__isnull=False, next_chat_at__lte=horizon
        )
        .exclude(status__in=[PersonStatus.ARCHIVED, PersonStatus.GHOSTED])
        .order_by("next_chat_at")[:10]
    ]

    tasks = [
        {
            "id": todo.id,
            "title": todo.title,
            "due_date": todo.due_date,
            "priority": todo.priority,
            "is_overdue": todo.is_overdue,
        }
        for todo in Todo.objects.filter(
            user=user, status=TodoStatus.OPEN, due_date__isnull=False,
            due_date__lte=horizon,
        ).order_by("due_date")[:10]
    ]

    # FR-APP-REJ-03 — a reapply reminder due soon surfaces the same way a
    # follow-up does, so it's never something you only notice by opening the
    # application by hand.
    reapplies = [
        {
            "id": app.id,
            "company": app.company.display_name,
            "outcome": app.get_outcome_display(),
            "reapply_at": app.reapply_at,
        }
        for app in Application.objects.filter(
            user=user, reapply_at__isnull=False, reapply_at__lte=horizon,
        ).select_related("company").order_by("reapply_at")[:10]
    ]

    return Response(
        {
            "follow_ups": follow_ups,
            "chats": chats,
            "tasks": tasks,
            "reapplies": reapplies,
        }
    )


def _company_ref(company, request):
    """Whose application an entry is about, for the chip's logo."""
    logo = None
    if company.logo:
        logo = request.build_absolute_uri(company.logo.url) if request else company.logo.url
    return {"id": company.id, "name": company.display_name, "logo": logo}


def _deadline_urgency(closing, today):
    """How loudly a closing date should shout: past, today/tomorrow, this
    week, or comfortably ahead."""
    days = (closing - today).days
    if days < 0:
        return "past"
    if days <= 1:
        return "critical"
    if days <= 7:
        return "soon"
    return "later"


def _person_ref(person, request):
    """Who an entry is with, for the calendar chip's face."""
    if not person:
        return None
    photo = None
    if person.photo:
        photo = request.build_absolute_uri(person.photo.url) if request else person.photo.url
    return {"id": person.id, "full_name": person.full_name, "photo": photo}


def _collect_calendar_events(user, start, end, request=None):
    """FR-CAL — every date-bearing domain, in one flat list.

    Shared by the JSON endpoint and the .ics export, so the two can never
    disagree about what belongs on the calendar. Read-only, like the rest of
    this module: it owns no data, it only draws from what each domain has.

    Entries tied to a person carry a `person` ref so the chip can show their
    face — a calendar of catch-ups is scanned by who, not by title.
    """
    events = []

    for todo in Todo.objects.filter(
        user=user, due_date__isnull=False, due_date__gte=start, due_date__lte=end
    ).select_related("person"):
        events.append(
            {
                "id": f"todo-{todo.id}",
                "domain": "todo",
                "title": todo.title,
                "date": todo.due_date.isoformat(),
                "done": todo.status == TodoStatus.DONE,
                "target_url": "/todos",
                "person": _person_ref(todo.person, request),
                # Timed when due_time is set — day/week timelines place the
                # chip on that hour; null keeps the previous all-day strip.
                "all_day": todo.due_time is None,
                "start_time": todo.due_time.isoformat() if todo.due_time else None,
                "end_time": (
                    todo.due_end_time.isoformat()
                    if todo.due_time and todo.due_end_time
                    else (
                        (
                            datetime.combine(todo.due_date, todo.due_time)
                            + timedelta(hours=1)
                        )
                        .time()
                        .isoformat()
                        if todo.due_time
                        else None
                    )
                ),
            }
        )

    applications = Application.objects.filter(user=user).select_related("company")
    for app in applications.filter(
        follow_up_date__isnull=False,
        follow_up_date__gte=start,
        follow_up_date__lte=end,
    ):
        events.append(
            {
                "id": f"followup-{app.id}",
                "domain": "application_followup",
                "title": f"Follow up: {app.company.display_name}",
                "date": app.follow_up_date.isoformat(),
                "done": app.outcome != Outcome.IN_PROGRESS,
                "target_url": f"/applications/{app.id}",
            }
        )
    # Closing dates of the listings each application covers — the one that
    # shuts first is the constraint, so it's the one on the calendar. Tagged
    # with an urgency so the chip's colour says how close it is.
    today = timezone.localdate()
    for app in applications.prefetch_related("listing_links__job_listing"):
        closing = application_deadline(app)
        if not closing:
            continue
        closing_date = parse_date(closing)
        if closing_date is None or closing_date < start or closing_date > end:
            continue
        events.append(
            {
                "id": f"deadline-{app.id}",
                "domain": "application_deadline",
                "title": f"Closes: {app.company.display_name}",
                "date": closing,
                "done": app.outcome != Outcome.IN_PROGRESS or closing_date < today,
                "target_url": f"/applications/{app.id}",
                "company": _company_ref(app.company, request),
                "urgency": _deadline_urgency(closing_date, today),
                "details": stage_label(app.stage),
            }
        )

    # The pipeline's own history: every stage and outcome move, on the day
    # it happened, so the calendar doubles as a timeline of what moved when.
    for log in (
        AppsEventLog.objects.filter(
            application__user=user,
            event_type__in=[EventType.CREATED, EventType.STAGE, EventType.OUTCOME],
            changed_at__date__gte=start,
            changed_at__date__lte=end,
        )
        .select_related("application__company")
        .order_by("changed_at")
    ):
        if log.event_type == EventType.OUTCOME:
            label = log.get_curr_outcome_display()
        else:
            label = stage_label(log.curr_stage) or log.curr_stage
        events.append(
            {
                "id": f"stage-{log.id}",
                "domain": "application_stage",
                "title": f"{log.application.company.display_name} · {label}",
                "date": timezone.localtime(log.changed_at).date().isoformat(),
                "done": False,
                "target_url": f"/applications/{log.application_id}",
                "company": _company_ref(log.application.company, request),
                "details": (
                    "Logged"
                    if log.event_type == EventType.CREATED
                    else f"{stage_label(log.prev_stage) or '—'} → {label}"
                    if log.event_type == EventType.STAGE
                    else f"Outcome: {label}"
                ),
            }
        )

    for app in applications.filter(
        reapply_at__isnull=False, reapply_at__gte=start, reapply_at__lte=end
    ):
        events.append(
            {
                "id": f"reapply-{app.id}",
                "domain": "application_reapply",
                "title": f"Reapply: {app.company.display_name}",
                "date": app.reapply_at.isoformat(),
                "done": False,
                "target_url": f"/applications/{app.id}",
            }
        )

    for person in Person.objects.filter(
        user=user, next_chat_at__isnull=False,
        next_chat_at__gte=start, next_chat_at__lte=end,
    ).exclude(status__in=[PersonStatus.ARCHIVED, PersonStatus.GHOSTED]):
        events.append(
            {
                "id": f"chat-{person.id}",
                "domain": "person_chat",
                "title": f"Catch up: {person.full_name}",
                "date": person.next_chat_at.isoformat(),
                "done": False,
                "target_url": f"/network/{person.id}",
                "person": _person_ref(person, request),
            }
        )

    # The catch-ups themselves, on the day they happened — logging one should
    # put it on the calendar without a second step.
    for catchup in (
        Catchup.objects.filter(user=user, met_on__gte=start, met_on__lte=end)
        # A message isn't an appointment — it has no place on a calendar.
        .exclude(format=CatchupFormat.MESSAGE)
        .select_related("person")
    ):
        events.append(
            {
                "id": f"catchup-{catchup.id}",
                "domain": "catchup",
                "title": f"{catchup.display_title} · {catchup.person.full_name}",
                "date": catchup.met_on.isoformat(),
                "done": False,
                "target_url": f"/catchups/{catchup.id}",
                "person": _person_ref(catchup.person, request),
                "details": " · ".join(
                    part for part in [catchup.display_format, catchup.location] if part
                ),
            }
        )

    for catchup in Catchup.objects.filter(
        user=user, follow_up_on__isnull=False,
        follow_up_on__gte=start, follow_up_on__lte=end,
    ).select_related("person"):
        events.append(
            {
                "id": f"catchup-followup-{catchup.id}",
                "domain": "catchup_followup",
                "title": f"Follow up with {catchup.person.full_name}",
                "date": catchup.follow_up_on.isoformat(),
                "done": False,
                "target_url": f"/network/{catchup.person_id}",
                "person": _person_ref(catchup.person, request),
            }
        )

    # FR-CAL-07 — the one domain Calendar actually owns: events with no home
    # anywhere else in the app.
    for custom in CalendarEvent.objects.filter(
        user=user, date__gte=start, date__lte=end
    ).prefetch_related("people"):
        first_person = custom.people.first()
        events.append(
            {
                "id": f"custom-{custom.id}",
                "domain": "custom",
                "title": custom.title,
                "date": custom.date.isoformat(),
                "done": custom.is_done,
                "target_url": "",
                "person": _person_ref(first_person, request),
                "all_day": custom.all_day,
                "start_time": custom.start_time.isoformat() if custom.start_time else None,
                "end_time": custom.end_time.isoformat() if custom.end_time else None,
            }
        )

    events.sort(key=lambda item: item["date"])
    return events


def _calendar_window(request):
    """`start`/`end` (YYYY-MM-DD) bound the window; both default to a year
    either side of today so a bare request is still useful."""
    today = timezone.localdate()
    start = parse_date(request.query_params.get("start") or "") or (
        today - timedelta(days=365)
    )
    end = parse_date(request.query_params.get("end") or "") or (
        today + timedelta(days=365)
    )
    return start, end


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def calendar_events(request):
    """FR-CAL — every date-bearing domain, aggregated for the calendar page."""
    start, end = _calendar_window(request)
    events = _collect_calendar_events(request.user, start, end, request)
    return Response({"start": start.isoformat(), "end": end.isoformat(), "events": events})


def _ics_escape(text):
    """RFC 5545 §3.3.11 TEXT escaping — backslash, then the characters that
    would otherwise be mistaken for value separators."""
    return (
        text.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
    )


def _ics_date(value):
    """A date.isoformat() ('2026-09-07') to the ICS all-day form ('20260907')."""
    return value.replace("-", "")


def build_ics(events, calendar_name="Career Tracker"):
    """Render events (from `_collect_calendar_events`) as an iCalendar file.

    Every domain except the user's own custom events is date-only, so those
    stay a full-day VEVENT — DTEND is the day after DTSTART, how RFC 5545
    expects a one-day all-day event to be expressed. A custom event with a
    real `start_time` gets a proper timed VEVENT instead (DTEND defaults to
    an hour after start when no `end_time` was set, so it's never a
    zero-length block). Hand-rolled rather than a dependency: the format
    needed is a handful of fixed fields, and pulling in a library for that
    would be the tail wagging the dog.
    """
    stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Career Tracker//Calendar Export//EN",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_ics_escape(calendar_name)}",
    ]

    for event in events:
        summary = event["title"]
        if event.get("done"):
            summary = f"[Done] {summary}"

        lines += ["BEGIN:VEVENT", f"UID:{event['id']}@career-tracker", f"DTSTAMP:{stamp}"]

        if event.get("start_time") and not event.get("all_day", True):
            event_date = date.fromisoformat(event["date"])
            start_dt = datetime.combine(event_date, time.fromisoformat(event["start_time"]))
            end_time = event.get("end_time")
            end_dt = (
                datetime.combine(event_date, time.fromisoformat(end_time))
                if end_time
                else start_dt + timedelta(hours=1)
            )
            lines += [
                f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%S')}",
            ]
        else:
            start = date.fromisoformat(event["date"])
            end = start + timedelta(days=1)
            lines += [
                f"DTSTART;VALUE=DATE:{_ics_date(event['date'])}",
                f"DTEND;VALUE=DATE:{_ics_date(end.isoformat())}",
            ]

        lines += [
            f"SUMMARY:{_ics_escape(summary)}",
            f"CATEGORIES:{event['domain'].upper()}",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    # RFC 5545 §3.1 requires CRLF line endings.
    return "\r\n".join(lines) + "\r\n"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def calendar_ics(request):
    """GET /api/dashboard/calendar.ics — download the window as a calendar
    file, importable into Google/Apple/Outlook calendar."""
    start, end = _calendar_window(request)
    events = _collect_calendar_events(request.user, start, end)
    payload = build_ics(events, calendar_name=f"Career Tracker — {request.user.username}")

    response = HttpResponse(payload, content_type="text/calendar; charset=utf-8")
    filename = f"career-tracker-{start.isoformat()}-to-{end.isoformat()}.ics"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _snippet(text, needle, radius=60):
    """A short window of text around the first match, so a long note doesn't
    have to be read in full to see why it matched."""
    index = text.lower().find(needle.lower())
    if index == -1:
        return text[: radius * 2].strip()
    start = max(0, index - radius)
    end = min(len(text), index + len(needle) + radius)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mentions(request):
    """GET /api/dashboard/mentions/?tag=DanielJohnson — every place this
    user's own notes @mention a given name or place.

    `@mention`s (FR-MENTION-*) are plain text, not a relation — a todo
    description, a contact's notes, a catch-up's minutes, a company's own
    note can each carry `@SarahChen` as a literal string. This is what makes
    that searchable again: given the tag the mention was inserted as (already
    computed client-side — the same "strip whitespace" rule that wrote it),
    it greps every notes-shaped field this user owns for it, so a contact's
    profile can show "you mentioned them here" without a stored link.
    """
    tag = (request.query_params.get("tag") or "").strip()
    if not tag:
        return Response([])
    needle = f"@{tag}"
    user = request.user
    results = []

    for todo in Todo.objects.filter(user=user, description__icontains=needle):
        results.append(
            {
                "domain": "todo",
                "id": todo.id,
                "title": todo.title,
                "snippet": _snippet(todo.description, needle),
                "url": "/todos",
            }
        )

    for person in Person.objects.filter(user=user, notes__icontains=needle):
        results.append(
            {
                "domain": "person_notes",
                "id": person.id,
                "title": f"{person.full_name}’s profile notes",
                "snippet": _snippet(person.notes, needle),
                "url": f"/network/{person.id}",
            }
        )

    catchups = Catchup.objects.filter(user=user).filter(
        Q(minutes__icontains=needle) | Q(takeaways__icontains=needle)
    ).select_related("person")
    for catchup in catchups:
        field = catchup.minutes if needle.lower() in catchup.minutes.lower() else catchup.takeaways
        results.append(
            {
                "domain": "catchup",
                "id": catchup.id,
                "title": f"Catch-up with {catchup.person.full_name}",
                "snippet": _snippet(field, needle),
                "url": f"/network/{catchup.person_id}",
            }
        )

    notes = CompanyNote.objects.filter(user=user, notes__icontains=needle).select_related("company")
    for note in notes:
        results.append(
            {
                "domain": "company_note",
                "id": note.company_id,
                "title": f"{note.company.display_name}’s notes",
                "snippet": _snippet(note.notes, needle),
                "url": f"/job-directory/companies/{note.company_id}",
            }
        )

    return Response(results)
