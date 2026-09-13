"""Write-side helpers for the applications domain.

The event log (FR-LOG-01..05) is append-only and is the source of truth for
the dashboard's time series, so every change to an application has to flow
through here rather than through a bare `Application.save()`.

One save produces at most one log row, even when a stage move and a handful of
field edits happen together — the row records the transition and carries the
field diff alongside it.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import AppsEventLog, EventType

# Fields worth remembering an edit to. Anything not listed here (timestamps,
# derived columns) would only add noise to the timeline.
TRACKED_FIELDS = [
    ("company", "Company"),
    ("applied_at", "Applied on"),
    ("follow_up_date", "Follow-up"),
    ("reapply_at", "Reapply reminder"),
    ("source", "Source"),
    ("resume", "Resume"),
    ("resume_version", "Resume version"),
    ("notes", "Notes"),
]

NOTES_PREVIEW = 120


def _display(application, field):
    """Render one field as the short string the timeline shows."""
    value = getattr(application, field, None)
    if value is None or value == "":
        return None
    if field == "company":
        return value.name
    if field == "resume":
        return value.label
    if field == "notes":
        text = str(value).strip()
        return text if len(text) <= NOTES_PREVIEW else f"{text[:NOTES_PREVIEW]}…"
    if field in {"applied_at", "follow_up_date", "reapply_at"}:
        return value.isoformat()
    return str(value)


def snapshot(application):
    """Capture the tracked fields, plus the roles linked to the application."""
    data = {field: _display(application, field) for field, _ in TRACKED_FIELDS}
    data["roles"] = ", ".join(
        sorted(link.job_listing.role.name for link in application.listing_links.all())
    ) or None
    return data


def diff(before, after):
    """Turn two snapshots into the timeline's change list."""
    labels = dict(TRACKED_FIELDS)
    labels["roles"] = "Roles"

    changes = []
    for field, label in labels.items():
        old, new = before.get(field), after.get(field)
        if old != new:
            changes.append({"field": field, "label": label, "from": old, "to": new})
    return changes


def _free_timestamp(application):
    """uniq_event_per_app_time is (application, changed_at). Two writes in the
    same request can land on an identical timestamp, so nudge forward until the
    slot is free instead of raising IntegrityError at the user."""
    changed_at = timezone.now()
    while AppsEventLog.objects.filter(
        application=application, changed_at=changed_at
    ).exists():
        changed_at += timedelta(microseconds=1)
    return changed_at


@transaction.atomic
def log_change(application, prev_stage, prev_outcome, changes=None, note="", changed_at=None):
    """Append one row if anything meaningful moved.

    Returns the created row, or None when nothing changed at all (FR-LOG-04) —
    re-saving an untouched form must not litter the history.

    `changed_at` lets a caller backdate the row — the historical-logging flow
    for an application that was already fully resolved before it was entered
    into the tracker, where "now" would be a lie about when each stage move
    actually happened. Real-time callers never pass it, so `_free_timestamp`
    (today, nudged clear of any collision) remains the default.
    """
    changes = changes or []
    stage_changed = prev_stage != application.stage
    outcome_changed = prev_outcome != application.outcome

    if not (stage_changed or outcome_changed or changes):
        return None

    if stage_changed:
        event_type = EventType.STAGE
    elif outcome_changed:
        event_type = EventType.OUTCOME
    else:
        event_type = EventType.EDITED

    if changed_at is None:
        changed_at = _free_timestamp(application)
    else:
        while AppsEventLog.objects.filter(
            application=application, changed_at=changed_at
        ).exists():
            changed_at += timedelta(microseconds=1)

    if stage_changed:
        application.stage_updated_at = changed_at
        application.save(update_fields=["stage_updated_at", "updated_at"])

    return AppsEventLog.objects.create(
        application=application,
        event_type=event_type,
        prev_stage=prev_stage or "",
        curr_stage=application.stage,
        prev_outcome=prev_outcome or "",
        curr_outcome=application.outcome,
        changes=changes,
        changed_at=changed_at,
        note=note or "",
    )


def log_transition(application, prev_stage, prev_outcome, note="", changed_at=None):
    """Stage/outcome only — the shape the `advance` action needs."""
    return log_change(application, prev_stage, prev_outcome, note=note, changed_at=changed_at)


def log_creation(application, note="Application created."):
    """Seed the log so a brand-new application already shows on the timeline."""
    return AppsEventLog.objects.create(
        application=application,
        event_type=EventType.CREATED,
        prev_stage="",
        curr_stage=application.stage,
        prev_outcome="",
        curr_outcome=application.outcome,
        changes=[],
        changed_at=_free_timestamp(application),
        note=note,
    )


def log_waiting(application, started, note="", changed_at=None, stage=None):
    """Record the ball moving into (or out of) the employer's court.

    Its own event type rather than a stage or outcome row: waiting is a state
    layered on top of both, and the dashboard time series counts stage rows as
    pipeline movement — a "waiting" row is not that.

    `stage` is the pipeline step the wait belongs to (usually the one just
    finished). Callers can override when the application's current stage is
    stale relative to a backdated history.
    """
    if changed_at is None:
        changed_at = _free_timestamp(application)
    else:
        # Two rows on one application may not share a timestamp.
        while AppsEventLog.objects.filter(
            application=application, changed_at=changed_at
        ).exists():
            changed_at += timedelta(microseconds=1)

    return AppsEventLog.objects.create(
        application=application,
        event_type=(
            EventType.WAITING_STARTED if started else EventType.WAITING_ENDED
        ),
        prev_stage="",
        curr_stage=stage or application.stage,
        prev_outcome="",
        curr_outcome=application.outcome,
        changes=[],
        changed_at=changed_at,
        note=note or "",
    )


def log_stage_done(application, note="", changed_at=None, stage=None):
    """Record that you finished a stage — before waiting on their reply."""
    if changed_at is None:
        changed_at = _free_timestamp(application)
    else:
        while AppsEventLog.objects.filter(
            application=application, changed_at=changed_at
        ).exists():
            changed_at += timedelta(microseconds=1)

    return AppsEventLog.objects.create(
        application=application,
        event_type=EventType.STAGE_DONE,
        prev_stage="",
        curr_stage=stage or application.stage,
        prev_outcome="",
        curr_outcome=application.outcome,
        changes=[],
        changed_at=changed_at,
        note=note or "",
    )


def end_waiting(application, note="", changed_at=None):
    """Clear the waiting flag and log it, if it was set.

    Called whenever the employer has plainly answered — a stage move or a
    terminal outcome — so the flag can never outlive the thing it was waiting
    for. Returns True when a row was written.
    """
    if not application.clear_waiting():
        return False
    application.save(update_fields=["awaiting_response", "awaiting_since", "updated_at"])
    log_waiting(application, started=False, note=note, changed_at=changed_at)
    return True


def settle_waiting(application, prev_stage, prev_outcome):
    """Close an open waiting period once the employer has plainly answered.

    A stage move or a terminal outcome both mean a reply arrived, so the flag
    should never survive either — otherwise an application sits there claiming
    it's waiting on a company that already rejected it.
    """
    from .models import Outcome

    if not application.awaiting_response:
        return False

    moved_stage = prev_stage != application.stage
    went_terminal = (
        prev_outcome != application.outcome and application.outcome in Outcome.terminal()
    )
    if not (moved_stage or went_terminal):
        return False

    return end_waiting(application)


def resync_waiting(application):
    """Realign `awaiting_since` with the log after a row is edited or deleted.

    The badge reads `awaiting_since` while the timeline reads the log rows, so
    correcting a "waiting" entry's date has to move both — otherwise the badge
    goes on quoting the moment you first ticked the box rather than when the
    stage was actually finished.

    Derived rather than patched in place: if the row that opened the period is
    deleted outright, there is nothing left saying you're waiting, so the flag
    goes with it.
    """
    if not application.awaiting_response:
        return False

    latest = (
        application.event_logs.filter(event_type=EventType.WAITING_STARTED)
        .order_by("-changed_at")
        .first()
    )
    if latest is None:
        application.clear_waiting()
        application.save(
            update_fields=["awaiting_response", "awaiting_since", "updated_at"]
        )
        return True

    if application.awaiting_since != latest.changed_at:
        application.awaiting_since = latest.changed_at
        application.save(update_fields=["awaiting_since", "updated_at"])
        return True
    return False
