"""Catch-up minutes (FR-CATCH-*)."""

from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Company
from network.models import Person

from .models import Catchup

User = get_user_model()


class CatchupApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.person = Person.objects.create(user=self.user, full_name="Sarah Chen")
        self.person.companies.set([self.company])

    def payload(self, **overrides):
        return {
            "person": self.person.id,
            "met_on": "2026-06-10",
            "title": "Coffee at Barangaroo",
            "format": "coffee",
            "minutes": "Talked about the vacationer intake and the AC format.",
            **overrides,
        }

    def test_creating_a_catchup_logs_the_meeting_on_the_person(self):
        response = self.client.post("/api/catchups/", self.payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)

        self.person.refresh_from_db()
        self.assertEqual(self.person.last_meeting_at, date(2026, 6, 10))
        # FR-CATCH-04 — the 3-month cadence rolls from the meeting.
        self.assertEqual(self.person.next_chat_at, date(2026, 9, 10))

    def test_explicit_follow_up_wins_over_the_cadence(self):
        self.client.post(
            "/api/catchups/", self.payload(follow_up_on="2026-07-01"), format="json"
        )
        self.person.refresh_from_db()
        self.assertEqual(self.person.next_chat_at, date(2026, 7, 1))

    def test_a_backdated_catchup_does_not_rewind_the_person(self):
        self.person.last_meeting_at = date(2026, 8, 1)
        self.person.save()

        self.client.post("/api/catchups/", self.payload(), format="json")
        self.person.refresh_from_db()
        self.assertEqual(self.person.last_meeting_at, date(2026, 8, 1))

    def test_follow_up_cannot_precede_the_meeting(self):
        response = self.client.post(
            "/api/catchups/", self.payload(follow_up_on="2026-01-01"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("follow_up_on", response.data)

    def test_cannot_minute_someone_elses_contact(self):
        theirs = Person.objects.create(user=self.other, full_name="Not Mine")
        response = self.client.post(
            "/api/catchups/", self.payload(person=theirs.id), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("person", response.data)

    def test_catchups_are_scoped_to_the_owner(self):
        theirs = Person.objects.create(user=self.other, full_name="Not Mine")
        Catchup.objects.create(
            user=self.other, person=theirs, met_on=date(2026, 6, 1)
        )
        mine = Catchup.objects.create(
            user=self.user, person=self.person, met_on=date(2026, 6, 2)
        )
        response = self.client.get("/api/catchups/")
        self.assertEqual([row["id"] for row in response.data], [mine.id])

    def test_filter_by_person_and_search_minutes(self):
        self.client.post("/api/catchups/", self.payload(), format="json")
        other_person = Person.objects.create(user=self.user, full_name="Marcus Webb")
        self.client.post(
            "/api/catchups/",
            self.payload(person=other_person.id, minutes="Design portfolio review"),
            format="json",
        )

        by_person = self.client.get("/api/catchups/", {"person": self.person.id})
        self.assertEqual(len(by_person.data), 1)

        by_search = self.client.get("/api/catchups/", {"search": "portfolio"})
        self.assertEqual(len(by_search.data), 1)
        self.assertEqual(by_search.data[0]["person_name"], "Marcus Webb")

    def test_response_carries_person_context_for_the_list_ui(self):
        response = self.client.post("/api/catchups/", self.payload(), format="json")
        self.assertEqual(response.data["person_name"], "Sarah Chen")
        self.assertEqual(response.data["person_companies"], ["EY"])
        self.assertEqual(response.data["display_title"], "Coffee at Barangaroo")

    def test_display_title_falls_back_to_the_format(self):
        response = self.client.post(
            "/api/catchups/", self.payload(title=""), format="json"
        )
        self.assertEqual(response.data["display_title"], "Coffee / in person")

    def test_person_detail_reports_how_many_catchups_they_have(self):
        self.client.post("/api/catchups/", self.payload(), format="json")
        response = self.client.get(f"/api/people/{self.person.id}/")
        self.assertEqual(response.data["catchup_count"], 1)

    def test_deleting_the_latest_catchup_recomputes_last_meeting(self):
        first = self.client.post(
            "/api/catchups/", self.payload(met_on="2026-05-01"), format="json"
        ).data
        second = self.client.post(
            "/api/catchups/", self.payload(met_on="2026-06-10", title="Second"), format="json"
        ).data

        self.client.delete(f"/api/catchups/{second['id']}/")
        self.person.refresh_from_db()
        self.assertEqual(self.person.last_meeting_at, date(2026, 5, 1))

        self.client.delete(f"/api/catchups/{first['id']}/")
        self.person.refresh_from_db()
        self.assertIsNone(self.person.last_meeting_at)

    def test_catchups_reach_the_activity_feed(self):
        self.client.post("/api/catchups/", self.payload(), format="json")
        response = self.client.get("/api/dashboard/activity/")
        row = next(r for r in response.data if r["domain"] == "catchup")
        self.assertIn("Sarah Chen", row["summary"])
        self.assertTrue(row["target_url"].startswith("/catchups/"))

    def test_choices_endpoint(self):
        response = self.client.get("/api/catchups/choices/")
        self.assertIn("format", response.data)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/catchups/").status_code, 401)


class CatchupFormatOtherTests(APITestCase):
    """FR-CATCH-11 — "Other" alone says nothing about what actually happened."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.person = Person.objects.create(user=self.user, full_name="Sarah Chen")

    def test_format_other_round_trips_and_drives_display_format(self):
        response = self.client.post(
            "/api/catchups/",
            {
                "person": self.person.id,
                "met_on": "2026-06-10",
                "format": "other",
                "format_other": "Hackathon",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["format_other"], "Hackathon")
        self.assertEqual(response.data["format_display"], "Hackathon")

    def test_display_format_falls_back_to_the_choice_label_normally(self):
        catchup = Catchup.objects.create(
            user=self.user, person=self.person, met_on=date(2026, 6, 10), format="coffee"
        )
        self.assertEqual(catchup.display_format, "Coffee / in person")
