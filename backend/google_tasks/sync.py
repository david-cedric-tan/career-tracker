"""Mirror todos into the user's Google Tasks list.

One direction only: this app is the source of truth, and each todo's
`google_task_id` remembers which Google task it owns so an edit updates that
task instead of adding a second one. Ticking a task off in Google doesn't
come back here.

Google calls happen on one background thread, never in the request that
saved the todo — a slow or unreachable Google must not slow down, or fail,
saving a todo. One thread (not one per change) also keeps jobs in the order
they were made, so "create" always lands before the "edit" that follows it.
"""

import logging
import queue
import threading
import time

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from todos.models import Todo, TodoStatus

from . import client
from .models import GoogleTasksConnection

logger = logging.getLogger(__name__)

TITLE_LIMIT = 1024
NOTES_LIMIT = 8192


# --- What a todo looks like as a Google task -------------------------------------


def _clock(value):
    return value.strftime("%I:%M %p").lstrip("0")


def task_body(todo):
    """The Google task fields for `todo`.

    Google Tasks keeps a due *date* only — whatever time is sent is dropped —
    so a timed todo carries its time as a "Time:" line at the top of the notes.
    """
    lines = []
    if todo.due_time:
        time_text = _clock(todo.due_time)
        if todo.due_end_time:
            time_text += f" – {_clock(todo.due_end_time)}"
        lines.append(f"Time: {time_text}")

    linked = []
    if todo.application_id:
        linked.append(f"{todo.application.company.display_name} application")
    if todo.person_id:
        linked.append(todo.person.full_name)
    if todo.company_id and not todo.application_id:
        linked.append(todo.company.display_name)
    if linked:
        lines.append("For: " + ", ".join(linked))

    if todo.description:
        if lines:
            lines.append("")
        lines.append(todo.description)

    done = todo.status == TodoStatus.DONE
    body = {
        "title": todo.title[:TITLE_LIMIT],
        "notes": "\n".join(lines)[:NOTES_LIMIT],
        # Null clears a date that was removed in the app.
        "due": f"{todo.due_date.isoformat()}T00:00:00.000Z" if todo.due_date else None,
        "status": "completed" if done else "needsAction",
        # Undo a delete made on the Google side: the app decides what exists.
        "deleted": False,
    }
    if not done:
        # Reopening a todo has to clear Google's completion stamp too; Google
        # stamps it by itself when the status becomes "completed".
        body["completed"] = None
    return body


# --- Jobs ------------------------------------------------------------------------


def connection_for(user_id):
    if not client.is_configured():
        return None
    return (
        GoogleTasksConnection.objects.filter(user_id=user_id)
        .exclude(refresh_token="")
        .first()
    )


def push_todo(todo_id):
    """Create, update, or (for a cancelled todo) remove the todo's Google task."""
    todo = (
        Todo.objects.select_related("application__company", "person", "company")
        .filter(pk=todo_id)
        .first()
    )
    if todo is None:
        return  # deleted before this job ran — its delete job handles Google
    connection = connection_for(todo.user_id)
    if connection is None:
        return
    list_id = client.ensure_tasklist(connection)

    if todo.status == TodoStatus.CANCELLED:
        if todo.google_task_id:
            _delete_remote(connection, list_id, todo.google_task_id)
            Todo.objects.filter(pk=todo.pk).update(google_task_id="")
        return

    body = task_body(todo)
    if todo.google_task_id:
        try:
            client.api(
                connection, "PATCH", f"/lists/{list_id}/tasks/{todo.google_task_id}", body
            )
            return
        except client.GoogleError as exc:
            # Gone for good (or it lived in a list from an earlier connection):
            # make a new one below.
            if exc.status not in (400, 404):
                raise

    created = client.api(connection, "POST", f"/lists/{list_id}/tasks", body)
    # `update()`, not `save()`: saving would fire the signal that queued this
    # job and loop forever.
    stored = Todo.objects.filter(pk=todo.pk).update(google_task_id=created["id"])
    if not stored:
        # The todo was deleted while Google was creating its task, so its
        # delete job saw no task id to remove. Clean up here instead.
        _delete_remote(connection, list_id, created["id"])


def delete_task(user_id, task_id):
    connection = connection_for(user_id)
    if connection is None or not connection.tasklist_id:
        return
    _delete_remote(connection, connection.tasklist_id, task_id)


def _delete_remote(connection, list_id, task_id):
    try:
        client.api(connection, "DELETE", f"/lists/{list_id}/tasks/{task_id}")
    except client.GoogleError as exc:
        if exc.status not in (404, 410):
            raise


def resync_all(user):
    """Queue every todo of `user` — the backfill after connecting."""
    ids = list(Todo.objects.filter(user=user).values_list("id", flat=True))
    for todo_id in ids:
        enqueue(("push", todo_id))
    return len(ids)


def run_job(job):
    kind, *args = job
    user_id = None
    try:
        if kind == "push":
            user_id = Todo.objects.filter(pk=args[0]).values_list("user_id", flat=True).first()
            _with_retry(push_todo, args[0])
        elif kind == "delete":
            user_id = args[0]
            _with_retry(delete_task, *args)
    except client.GoogleError as exc:
        logger.warning("Google Tasks sync failed for %s: %s", job, exc)
        if user_id is not None:
            GoogleTasksConnection.objects.filter(user_id=user_id).update(
                last_error=str(exc)[:1000]
            )
        return
    if user_id is not None:
        GoogleTasksConnection.objects.filter(user_id=user_id).exclude(
            refresh_token=""
        ).update(last_synced_at=timezone.now(), last_error="")


def _with_retry(func, *args):
    """One retry for Google's "slow down" and temporary failures."""
    try:
        return func(*args)
    except client.NotConnected:
        raise
    except client.GoogleError as exc:
        if exc.status is not None and exc.status != 429 and exc.status < 500:
            raise
        time.sleep(2)
        return func(*args)


# --- Background worker -------------------------------------------------------------

_jobs = queue.Queue()
_worker = None
_worker_lock = threading.Lock()


def enqueue(job):
    if settings.GOOGLE_TASKS_SYNC_INLINE:
        run_job(job)
        return
    _ensure_worker()
    _jobs.put(job)


def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(
                target=_work, name="google-tasks-sync", daemon=True
            )
            _worker.start()


def _work():
    while True:
        job = _jobs.get()
        close_old_connections()
        try:
            run_job(job)
        except Exception:  # noqa: BLE001 — one bad job mustn't kill the worker
            logger.exception("Google Tasks sync job crashed: %s", job)
        finally:
            close_old_connections()
            _jobs.task_done()
