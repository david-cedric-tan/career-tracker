"""The Settings "delete all my data" action.

The risk this covers is a *partial* delete: a button that promises to remove
everything but leaves calendar events or education entries behind is worse
than no button at all.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Application, Company, Resume
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import Person
from todos.models import Todo

from .models import Education, ProfileLink

User = get_user_model()


class DeleteAllDataTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def seed(self, user):
        Application.objects.create(user=user, company=self.company)
        Resume.objects.create(user=user, label=f"{user.username}-resume")
        person = Person.objects.create(user=user, full_name="Jess Nguyen")
        Catchup.objects.create(user=user, person=person, met_on="2026-01-05", title="Chat")
        Todo.objects.create(user=user, title="Follow up")
        CalendarEvent.objects.create(user=user, title="Career fair", date="2026-02-01")
        Education.objects.create(user=user, school="UNSW", started_on="2023-02-01")
        ProfileLink.objects.create(user=user, label="GitHub", url="https://github.com/x")

    def test_confirm_is_required(self):
        self.seed(self.user)
        response = self.client.post("/api/auth/me/delete-data/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)

    def test_deletes_every_domain(self):
        self.seed(self.user)
        response = self.client.post(
            "/api/auth/me/delete-data/", {"confirm": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        for model in (Application, Resume, Person, Catchup, Todo, CalendarEvent,
                      Education, ProfileLink):
            self.assertEqual(
                model.objects.filter(user=self.user).count(), 0, f"{model.__name__} survived"
            )

    def test_account_and_shared_reference_data_survive(self):
        """The account stays signed in, and companies are shared — deleting
        one user's data must not remove reference rows others point at."""
        self.seed(self.user)
        self.client.post("/api/auth/me/delete-data/", {"confirm": True}, format="json")
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())
        self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_does_not_touch_another_account(self):
        self.seed(self.user)
        self.seed(self.other)
        self.client.post("/api/auth/me/delete-data/", {"confirm": True}, format="json")
        self.assertEqual(Application.objects.filter(user=self.other).count(), 1)
        self.assertEqual(Todo.objects.filter(user=self.other).count(), 1)
        self.assertEqual(CalendarEvent.objects.filter(user=self.other).count(), 1)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            "/api/auth/me/delete-data/", {"confirm": True}, format="json"
        )
        self.assertEqual(response.status_code, 401)
