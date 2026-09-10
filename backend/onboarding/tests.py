from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Application, Company
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import Person
from todos.models import Todo

from .models import SampleDataRecord
from .services import SAMPLE_COMPANY_NAME, seed_sample_data

User = get_user_model()


class SampleDataApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_seed_creates_one_row_per_domain(self):
        response = self.client.post("/api/onboarding/sample-data/seed/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Todo.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Person.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Catchup.objects.filter(user=self.user).count(), 1)
        self.assertEqual(CalendarEvent.objects.filter(user=self.user).count(), 1)
        categories = {row["category"] for row in response.data}
        self.assertEqual(categories, {"application", "todo", "catchup", "event"})

    def test_seed_is_idempotent(self):
        seed_sample_data(self.user)
        seed_sample_data(self.user)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)
        self.assertEqual(SampleDataRecord.objects.filter(user=self.user).count(), 5)

    def test_seed_scoped_to_user(self):
        other = User.objects.create_user("mallory", password="tracker-pass-9182")
        seed_sample_data(other)
        response = self.client.get("/api/onboarding/sample-data/")
        self.assertEqual(response.data, [])

    def test_cleanup_keeps_only_chosen_categories(self):
        seed_sample_data(self.user)
        response = self.client.post(
            "/api/onboarding/sample-data/cleanup/", {"keep": ["application"]}, format="json"
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Todo.objects.filter(user=self.user).count(), 0)
        self.assertEqual(Person.objects.filter(user=self.user).count(), 0)
        self.assertEqual(Catchup.objects.filter(user=self.user).count(), 0)
        self.assertEqual(CalendarEvent.objects.filter(user=self.user).count(), 0)
        self.assertEqual(SampleDataRecord.objects.filter(user=self.user).count(), 0)

    def test_cleanup_discard_all_removes_sample_company_too(self):
        seed_sample_data(self.user)
        self.assertTrue(Company.objects.filter(name=SAMPLE_COMPANY_NAME).exists())
        self.client.post("/api/onboarding/sample-data/cleanup/", {"keep": []}, format="json")
        self.assertFalse(Company.objects.filter(name=SAMPLE_COMPANY_NAME).exists())

    def test_catchup_and_its_person_travel_together(self):
        """The sample catchup can't outlive its person (a non-nullable FK) —
        both are tracked under the same category so a keep/discard choice
        never leaves one without the other."""
        seed_sample_data(self.user)
        self.client.post(
            "/api/onboarding/sample-data/cleanup/", {"keep": ["catchup"]}, format="json"
        )
        self.assertEqual(Person.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Catchup.objects.filter(user=self.user).count(), 1)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.get("/api/onboarding/sample-data/")
        self.assertEqual(response.status_code, 401)
