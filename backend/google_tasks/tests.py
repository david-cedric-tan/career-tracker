"""Google Tasks sync — Google itself is faked at the HTTP layer."""

from datetime import date, time
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from applications.models import Application, Company
from todos.models import Todo, TodoStatus

from . import client
from .models import GoogleTasksConnection
from .sync import task_body

User = get_user_model()

GOOGLE_SETTINGS = {
    "GOOGLE_OAUTH_CLIENT_ID": "client-id",
    "GOOGLE_OAUTH_CLIENT_SECRET": "client-secret",
    "GOOGLE_TASKS_SYNC_INLINE": True,
}


class FakeGoogle:
    """Enough of the token endpoint and Tasks API to drive the sync."""

    def __init__(self):
        self.lists = {}
        self.tasks = {}
        self.calls = []
        self._next = 0

    def _id(self, prefix):
        self._next += 1
        return f"{prefix}{self._next}"

    def __call__(self, method, url, *, form=None, body=None, token=None):
        self.calls.append((method, url, body))
        if url == client.TOKEN_URL:
            return {"access_token": "access", "expires_in": 3600, "refresh_token": "refresh"}
        if url.startswith(client.REVOKE_URL):
            return {}
        path = url.removeprefix(client.API_ROOT)
        if path.startswith("/users/@me/lists"):
            if method == "POST":
                new = {"id": self._id("list"), "title": body["title"]}
                self.lists[new["id"]] = new
                return new
            if "?" in path:
                return {"items": list(self.lists.values())}
            list_id = path.rsplit("/", 1)[1]
            if list_id not in self.lists:
                raise client.GoogleError("missing", status=404)
            return self.lists[list_id]
        # /lists/<list>/tasks[/<task>]
        parts = path.strip("/").split("/")
        task_id = parts[3] if len(parts) > 3 else None
        if method == "POST":
            new = {"id": self._id("task"), **body}
            self.tasks[new["id"]] = new
            return new
        if task_id not in self.tasks:
            raise client.GoogleError("missing", status=404)
        if method == "PATCH":
            self.tasks[task_id].update(body)
            return self.tasks[task_id]
        if method == "DELETE":
            del self.tasks[task_id]
            return {}
        raise AssertionError(f"unexpected {method} {url}")


@override_settings(**GOOGLE_SETTINGS)
class SyncTests(TestCase):
    def setUp(self):
        self.google = FakeGoogle()
        patcher = mock.patch.object(client, "_http", self.google)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        GoogleTasksConnection.objects.create(user=self.user, refresh_token="refresh")

    def make_todo(self, **fields):
        with self.captureOnCommitCallbacks(execute=True):
            return Todo.objects.create(user=self.user, **fields)

    def save(self, todo):
        with self.captureOnCommitCallbacks(execute=True):
            todo.save()

    def test_new_todo_becomes_a_task_in_its_own_list(self):
        todo = self.make_todo(title="Send thank-you note", due_date=date(2026, 10, 2))
        todo.refresh_from_db()
        task = self.google.tasks[todo.google_task_id]
        self.assertEqual(task["title"], "Send thank-you note")
        self.assertEqual(task["due"], "2026-10-02T00:00:00.000Z")
        self.assertEqual(task["status"], "needsAction")
        self.assertEqual([l["title"] for l in self.google.lists.values()], ["Career Tracker"])

    def test_edit_updates_the_same_task(self):
        todo = self.make_todo(title="Prep OA")
        todo.refresh_from_db()
        todo.title = "Prep OA (HackerRank)"
        todo.status = TodoStatus.DONE
        todo.sync_completion()
        self.save(todo)
        self.assertEqual(len(self.google.tasks), 1)
        task = self.google.tasks[todo.google_task_id]
        self.assertEqual(task["title"], "Prep OA (HackerRank)")
        self.assertEqual(task["status"], "completed")

    def test_delete_and_cancel_remove_the_task(self):
        kept = self.make_todo(title="Cancel me")
        gone = self.make_todo(title="Delete me")
        kept.refresh_from_db()
        gone.refresh_from_db()

        with self.captureOnCommitCallbacks(execute=True):
            gone.delete()
        kept.status = TodoStatus.CANCELLED
        self.save(kept)

        self.assertEqual(self.google.tasks, {})
        kept.refresh_from_db()
        self.assertEqual(kept.google_task_id, "")

    def test_task_deleted_in_google_is_recreated_on_next_edit(self):
        todo = self.make_todo(title="Follow up")
        todo.refresh_from_db()
        self.google.tasks.clear()
        todo.title = "Follow up again"
        self.save(todo)
        todo.refresh_from_db()
        self.assertEqual(self.google.tasks[todo.google_task_id]["title"], "Follow up again")

    def test_nothing_is_sent_for_an_unconnected_user(self):
        other = User.objects.create_user("mallory", password="s3cret-pass-123")
        with self.captureOnCommitCallbacks(execute=True):
            Todo.objects.create(user=other, title="Private")
        self.assertEqual(self.google.tasks, {})

    def test_failure_is_recorded_without_breaking_the_save(self):
        def broken(*args, **kwargs):
            raise client.GoogleError("Google returned 403: nope", status=403)

        with mock.patch.object(client, "_http", broken):
            todo = self.make_todo(title="Still saved")
        self.assertTrue(Todo.objects.filter(pk=todo.pk).exists())
        connection = GoogleTasksConnection.objects.get(user=self.user)
        self.assertIn("403", connection.last_error)


class TaskBodyTests(TestCase):
    def test_time_goes_in_the_notes(self):
        user = User.objects.create_user("dave", password="s3cret-pass-123")
        application = Application.objects.create(
            user=user, company=Company.objects.create(name="EY")
        )
        todo = Todo(
            user=user,
            title="Interview",
            description="Bring portfolio",
            due_date=date(2026, 10, 2),
            due_time=time(14, 0),
            due_end_time=time(15, 30),
            application=application,
        )
        self.assertEqual(
            task_body(todo)["notes"],
            "Time: 2:00 PM – 3:30 PM\nFor: EY application\n\nBring portfolio",
        )

    def test_all_day_todo_has_no_time_line(self):
        todo = Todo(title="Update resume", due_date=date(2026, 10, 2))
        body = task_body(todo)
        self.assertEqual(body["notes"], "")
        self.assertIsNone(body["completed"])


@override_settings(**GOOGLE_SETTINGS)
class ConnectApiTests(APITestCase):
    def setUp(self):
        self.google = FakeGoogle()
        patcher = mock.patch.object(client, "_http", self.google)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)

    def test_connect_round_trip_backfills_existing_todos(self):
        Todo.objects.create(user=self.user, title="Already here")

        response = self.client.post(
            "/api/google-tasks/start/", {"redirect_uri": "http://localhost/google-tasks"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("code_challenge=", response.data["auth_url"])
        state = GoogleTasksConnection.objects.get(user=self.user).pending_state

        response = self.client.post(
            "/api/google-tasks/complete/",
            {"url": f"http://localhost/google-tasks?state={state}&code=abc&scope=x"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["connected"])
        self.assertEqual(response.data["synced_count"], 1)

    def test_stale_state_is_refused(self):
        self.client.post("/api/google-tasks/start/", {})
        response = self.client.post(
            "/api/google-tasks/complete/",
            {"url": "http://localhost/google-tasks?state=wrong&code=abc"},
        )
        self.assertEqual(response.status_code, 400)

    def test_non_loopback_redirect_is_refused(self):
        response = self.client.post(
            "/api/google-tasks/start/", {"redirect_uri": "https://evil.example/cb"}
        )
        self.assertEqual(response.status_code, 400)

    def test_disconnect_forgets_task_ids(self):
        GoogleTasksConnection.objects.create(user=self.user, refresh_token="refresh")
        todo = Todo.objects.create(user=self.user, title="x")
        Todo.objects.filter(pk=todo.pk).update(google_task_id="task9")

        response = self.client.post("/api/google-tasks/disconnect/")
        self.assertFalse(response.data["connected"])
        self.assertFalse(GoogleTasksConnection.objects.filter(user=self.user).exists())
        todo.refresh_from_db()
        self.assertEqual(todo.google_task_id, "")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_SECRET="")
    def test_status_reports_unconfigured_server(self):
        response = self.client.get("/api/google-tasks/")
        self.assertFalse(response.data["configured"])
