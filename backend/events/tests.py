"""User-created calendar events (FR-CAL-07)."""

from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Application, Company
from network.models import Person

from .models import CalendarEvent

User = get_user_model()


class CalendarEventApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_create_event(self):
        # `all_day` explicit: multipart form posts (the test client's default
        # encoding) send an absent boolean as False, not the model's True
        # default — that's an HTML-forms convention (an unchecked checkbox
        # sends nothing), not something real JSON requests from the SPA hit.
        response = self.client.post(
            "/api/events/",
            {"title": "Career fair", "date": "2026-10-01", "notes": "City hall", "all_day": True},
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["title"], "Career fair")
        self.assertFalse(response.data["is_done"])
        self.assertEqual(response.data["reminders"], [])

    def test_timed_event_without_start_time_is_rejected(self):
        response = self.client.post(
            "/api/events/",
            {"title": "Interview", "date": "2026-10-01", "all_day": False},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("start_time", response.data)

    def test_timed_event_gets_default_reminder(self):
        response = self.client.post(
            "/api/events/",
            {
                "title": "Interview",
                "date": "2026-10-01",
                "all_day": False,
                "start_time": "14:00:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["reminders"]), 1)
        self.assertEqual(response.data["reminders"][0]["minutes_before"], 30)
        self.assertEqual(response.data["reminders"][0]["fires_at"], "2026-10-01T13:30:00")

    def test_create_event_with_explicit_reminders(self):
        response = self.client.post(
            "/api/events/",
            {
                "title": "Interview",
                "date": "2026-10-01",
                "all_day": False,
                "start_time": "14:00:00",
                "reminders": [{"minutes_before": 60}, {"minutes_before": 1440}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        minutes = sorted(r["minutes_before"] for r in response.data["reminders"])
        self.assertEqual(minutes, [60, 1440])

    def test_all_day_event_reminder_references_nine_am(self):
        response = self.client.post(
            "/api/events/",
            {
                "title": "Career fair",
                "date": "2026-10-01",
                "all_day": True,
                "reminders": [{"minutes_before": 60}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["reminders"][0]["fires_at"], "2026-10-01T08:00:00")

    def test_update_replaces_reminders(self):
        event = CalendarEvent.objects.create(
            user=self.user,
            title="Interview",
            date=date(2026, 3, 1),
            all_day=False,
            start_time="09:00:00",
        )
        event.reminders.create(minutes_before=30)
        response = self.client.patch(
            f"/api/events/{event.id}/",
            {"reminders": [{"minutes_before": 15}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [r["minutes_before"] for r in response.data["reminders"]], [15]
        )

    def test_blank_title_is_rejected(self):
        response = self.client.post("/api/events/", {"title": "   ", "date": "2026-10-01"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("title", response.data)

    def test_list_scoped_to_owner(self):
        CalendarEvent.objects.create(user=self.user, title="Mine", date=date(2026, 1, 1))
        CalendarEvent.objects.create(user=self.other, title="Not mine", date=date(2026, 1, 1))
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([e["title"] for e in response.data], ["Mine"])

    def test_filter_by_date_range(self):
        CalendarEvent.objects.create(user=self.user, title="In range", date=date(2026, 6, 15))
        CalendarEvent.objects.create(user=self.user, title="Out of range", date=date(2026, 12, 1))
        response = self.client.get(
            "/api/events/", {"start": "2026-06-01", "end": "2026-06-30"}
        )
        self.assertEqual([e["title"] for e in response.data], ["In range"])

    def test_update_and_toggle_done(self):
        event = CalendarEvent.objects.create(
            user=self.user, title="Draft", date=date(2026, 3, 1)
        )
        response = self.client.patch(
            f"/api/events/{event.id}/", {"is_done": True, "title": "Final"}
        )
        self.assertEqual(response.status_code, 200)
        event.refresh_from_db()
        self.assertTrue(event.is_done)
        self.assertEqual(event.title, "Final")

    def test_delete(self):
        event = CalendarEvent.objects.create(user=self.user, title="Gone", date=date(2026, 3, 1))
        response = self.client.delete(f"/api/events/{event.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(CalendarEvent.objects.filter(id=event.id).exists())

    def test_cannot_edit_another_users_event(self):
        event = CalendarEvent.objects.create(
            user=self.other, title="Theirs", date=date(2026, 3, 1)
        )
        response = self.client.patch(f"/api/events/{event.id}/", {"title": "Hijacked"})
        self.assertEqual(response.status_code, 404)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 401)


class EventLinkTests(APITestCase):
    """An event is usually about something you already track: the company
    running the info session, the application whose assessment centre it is,
    and the people it put you in a room with."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="Deloitte")
        self.application = Application.objects.create(user=self.user, company=self.company)
        self.person = Person.objects.create(user=self.user, full_name="Ana Reyes")

    def test_event_can_link_company_application_and_people(self):
        response = self.client.post(
            "/api/events/",
            {
                "title": "Deloitte Assessment Centre",
                "date": "2026-05-01",
                "all_day": True,
                "company": self.company.id,
                "application": self.application.id,
                "people": [self.person.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["company_name"], "Deloitte")
        self.assertIn("Deloitte", response.data["application_label"])
        self.assertEqual(
            [p["full_name"] for p in response.data["people_details"]], ["Ana Reyes"]
        )

    def test_links_are_all_optional(self):
        response = self.client.post(
            "/api/events/",
            {"title": "Dentist", "date": "2026-05-01", "all_day": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["company_name"])
        self.assertIsNone(response.data["application_label"])
        self.assertEqual(response.data["people_details"], [])

    def test_cannot_attach_someone_elses_contact(self):
        theirs = Person.objects.create(user=self.other, full_name="Not Mine")
        response = self.client.post(
            "/api/events/",
            {"title": "Fair", "date": "2026-05-01", "all_day": True, "people": [theirs.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("people", response.data)

    def test_cannot_attach_someone_elses_application(self):
        theirs = Application.objects.create(user=self.other, company=self.company)
        response = self.client.post(
            "/api/events/",
            {"title": "AC", "date": "2026-05-01", "all_day": True, "application": theirs.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("application", response.data)

    def test_filtering_to_events_that_have_people(self):
        met = CalendarEvent.objects.create(
            user=self.user, title="USYD Coding Fest 2026", date=date(2026, 3, 2)
        )
        met.people.add(self.person)
        CalendarEvent.objects.create(user=self.user, title="Dentist", date=date(2026, 3, 3))
        response = self.client.get("/api/events/?with_people=1")
        self.assertEqual([row["title"] for row in response.data], ["USYD Coding Fest 2026"])

    def test_deleting_the_application_keeps_the_event(self):
        """The assessment centre still happened, even if you bin the
        application it came from."""
        event = CalendarEvent.objects.create(
            user=self.user, title="Deloitte AC", date=date(2026, 5, 1),
            application=self.application,
        )
        self.application.delete()
        event.refresh_from_db()
        self.assertIsNone(event.application)
        self.assertEqual(event.title, "Deloitte AC")
