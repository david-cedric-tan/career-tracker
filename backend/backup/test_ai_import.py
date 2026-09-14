"""BYO-AI tracker import — merge JSON shaped like importGuide.ts into an account."""

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from applications.models import Application, Company
from catchups.models import Catchup
from events.models import CalendarEvent
from network.models import ContactMethod, Person
from todos.models import Todo

User = get_user_model()


class AiImportTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="importer", password="x")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_merges_applications_people_and_todos(self):
        response = self.client.post(
            "/api/backup/import-ai/",
            {
                "companies": [
                    {
                        "name": "Ernst & Young",
                        "short_name": "EY",
                        "regions": ["Australia"],
                    }
                ],
                "applications": [
                    {
                        "company": "EY",
                        "role": "Graduate Analyst",
                        "stage": "applied",
                        "outcome": "in_progress",
                        "applied_at": "2026-03-01",
                        "awaiting_response": True,
                    }
                ],
                "people": [
                    {
                        "full_name": "Sam Recruiter",
                        "company": "EY",
                        "status": "connection",
                        "relationship": "recruiter",
                        "email": "sam@ey.example",
                        "linkedin": "https://linkedin.com/in/sam",
                    }
                ],
                "todos": [
                    {
                        "title": "Prep for EY OA",
                        "priority": "high",
                        "company": "EY",
                        "due_date": "2026-03-10",
                    }
                ],
                "catchups": [
                    {
                        "person": "Sam Recruiter",
                        "met_on": "2026-02-20",
                        "format": "coffee",
                        "minutes": "Talked about the grad stream",
                    }
                ],
                "calendar_events": [
                    {
                        "title": "EY assessment centre",
                        "date": "2026-04-01",
                        "company": "EY",
                        "people": ["Sam Recruiter"],
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["applications"]["created"], 1)
        self.assertEqual(response.data["people"]["created"], 1)
        self.assertEqual(response.data["todos"]["created"], 1)
        self.assertEqual(response.data["catchups"]["created"], 1)
        self.assertEqual(response.data["calendar_events"]["created"], 1)

        company = Company.objects.get(short_name="EY")
        self.assertEqual(company.name, "Ernst & Young")
        self.assertTrue(company.regions.filter(name="Australia").exists())

        application = Application.objects.get(user=self.user)
        self.assertEqual(application.company_id, company.id)
        self.assertTrue(application.awaiting_response)
        self.assertEqual(
            list(application.listings.values_list("role__name", flat=True)),
            ["Graduate Analyst"],
        )

        person = Person.objects.get(user=self.user, full_name="Sam Recruiter")
        self.assertEqual(person.relationship.name, "Recruiter")
        self.assertTrue(
            ContactMethod.objects.filter(
                person=person, channel="email", value="sam@ey.example"
            ).exists()
        )
        self.assertTrue(Catchup.objects.filter(user=self.user, person=person).exists())
        self.assertTrue(Todo.objects.filter(user=self.user, title="Prep for EY OA").exists())
        event = CalendarEvent.objects.get(user=self.user, title="EY assessment centre")
        self.assertEqual(event.company_id, company.id)
        self.assertTrue(event.people.filter(id=person.id).exists())

    def test_does_not_wipe_existing_rows(self):
        Company.objects.create(name="Keep Me")
        Application.objects.create(
            user=self.user,
            company=Company.objects.get(name="Keep Me"),
            stage="applied",
        )
        response = self.client.post(
            "/api/backup/import-ai/",
            {
                "applications": [
                    {
                        "company": "New Co",
                        "role": "Intern",
                        "applied_at": "2026-01-15",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 2)

    def test_skips_duplicate_application(self):
        payload = {
            "applications": [
                {
                    "company": "Canva",
                    "role": "Designer",
                    "applied_at": "2026-02-01",
                }
            ]
        }
        first = self.client.post("/api/backup/import-ai/", payload, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        second = self.client.post("/api/backup/import-ai/", payload, format="json")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["applications"]["skipped"], 1)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)

    def test_rejects_backup_shaped_json(self):
        response = self.client.post(
            "/api/backup/import-ai/",
            {"version": 1, "username": "importer", "applications": []},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("backup", response.data["detail"].lower())

    def test_empty_payload_is_rejected(self):
        response = self.client.post("/api/backup/import-ai/", {}, format="json")
        self.assertEqual(response.status_code, 400)
