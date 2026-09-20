"""API checks for todos (FR-TODO-*)."""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from applications.models import Application, Company, Outcome
from network.models import Person

from .models import Todo, TodoStatus

User = get_user_model()


class TodoApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.application = Application.objects.create(
            user=self.user, company=self.company
        )

    def test_completing_a_todo_stamps_completed_at(self):
        todo = Todo.objects.create(user=self.user, title="Message Sarah")
        response = self.client.post(f"/api/todos/{todo.id}/toggle/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], TodoStatus.DONE)
        self.assertIsNotNone(response.data["completed_at"])

        response = self.client.post(f"/api/todos/{todo.id}/toggle/")
        self.assertEqual(response.data["status"], TodoStatus.OPEN)
        self.assertIsNone(response.data["completed_at"])

    def test_duplicate_open_todo_is_rejected(self):
        payload = {"title": "Follow up", "due_date": "2026-09-10"}
        self.assertEqual(
            self.client.post("/api/todos/", payload, format="json").status_code, 201
        )
        response = self.client.post("/api/todos/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("title", response.data)

    def test_cannot_link_to_another_users_application(self):
        theirs = Application.objects.create(user=self.other, company=self.company)
        response = self.client.post(
            "/api/todos/",
            {"title": "Sneak", "application": theirs.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("application", response.data)

    def test_overdue_scope(self):
        Todo.objects.create(
            user=self.user, title="Late", due_date=date(2020, 1, 1)
        )
        Todo.objects.create(
            user=self.user, title="Future", due_date=date(2099, 1, 1)
        )
        response = self.client.get("/api/todos/", {"scope": "overdue"})
        self.assertEqual([row["title"] for row in response.data], ["Late"])
        self.assertTrue(response.data[0]["is_overdue"])

    def test_due_time_round_trips_and_clears_with_date(self):
        response = self.client.post(
            "/api/todos/",
            {
                "title": "OA at 2",
                "due_date": "2026-09-10",
                "due_time": "14:00:00",
                "due_end_time": "15:30:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["due_time"], "14:00:00")
        self.assertEqual(response.data["due_end_time"], "15:30:00")

        todo_id = response.data["id"]
        cleared = self.client.patch(
            f"/api/todos/{todo_id}/",
            {"due_date": None},
            format="json",
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.data["due_date"])
        self.assertIsNone(cleared.data["due_time"])
        self.assertIsNone(cleared.data["due_end_time"])

    def test_due_end_time_must_be_after_start(self):
        response = self.client.post(
            "/api/todos/",
            {
                "title": "Bad window",
                "due_date": "2026-09-10",
                "due_time": "14:00:00",
                "due_end_time": "13:00:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("due_end_time", response.data)

    def test_suggestions_come_from_due_dates_elsewhere(self):
        yesterday = timezone.localdate() - timedelta(days=1)
        self.application.follow_up_date = yesterday
        self.application.outcome = Outcome.IN_PROGRESS
        self.application.save()
        Person.objects.create(
            user=self.user, full_name="Sarah Chen", next_chat_at=yesterday
        )

        response = self.client.get("/api/todos/suggestions/")
        self.assertEqual(response.status_code, 200)
        kinds = {row["kind"] for row in response.data}
        self.assertEqual(kinds, {"application", "person"})

        # Once a todo already covers the application, it drops off the list.
        Todo.objects.create(
            user=self.user, title="Follow up on EY", application=self.application
        )
        response = self.client.get("/api/todos/suggestions/")
        self.assertEqual({row["kind"] for row in response.data}, {"person"})

    def test_todos_are_scoped_to_the_owner(self):
        Todo.objects.create(user=self.other, title="Theirs")
        mine = Todo.objects.create(user=self.user, title="Mine")
        response = self.client.get("/api/todos/")
        self.assertEqual([row["id"] for row in response.data], [mine.id])


class TodoReorderTests(APITestCase):
    """Dragging a list into shape is its own view of the same todos — the
    "Custom" sort. Every other sort ignores `position`."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.a = Todo.objects.create(user=self.user, title="A")
        self.b = Todo.objects.create(user=self.user, title="B")
        self.c = Todo.objects.create(user=self.user, title="C")

    def test_reorder_sets_positions_in_the_order_given(self):
        response = self.client.post(
            "/api/todos/reorder/", {"ids": [self.c.id, self.a.id, self.b.id]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        ordered = self.client.get("/api/todos/?ordering=position").data
        self.assertEqual([row["title"] for row in ordered], ["C", "A", "B"])

    def test_other_sorts_ignore_the_manual_order(self):
        self.client.post(
            "/api/todos/reorder/", {"ids": [self.c.id, self.b.id, self.a.id]}, format="json"
        )
        ordered = self.client.get("/api/todos/?ordering=title").data
        self.assertEqual([row["title"] for row in ordered], ["A", "B", "C"])

    def test_a_new_todo_lands_at_the_top_of_the_manual_order(self):
        self.client.post(
            "/api/todos/reorder/", {"ids": [self.a.id, self.b.id, self.c.id]}, format="json"
        )
        self.client.post("/api/todos/", {"title": "Just written down"}, format="json")
        ordered = self.client.get("/api/todos/?ordering=position").data
        self.assertEqual(ordered[0]["title"], "Just written down")

    def test_cannot_reorder_someone_elses_todos(self):
        theirs = Todo.objects.create(user=self.other, title="Not mine")
        response = self.client.post(
            "/api/todos/reorder/", {"ids": [self.a.id, theirs.id]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        theirs.refresh_from_db()
        self.assertEqual(theirs.position, 0)

    def test_a_malformed_payload_is_rejected(self):
        response = self.client.post("/api/todos/reorder/", {"ids": "nope"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("ids", response.data)
