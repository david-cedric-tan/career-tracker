"""API checks for the network domain, focused on the cadence rule (FR-NET-10)."""

from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Company

from .models import ContactMethod, MetSourceTag, Person, RelationshipTag, add_months

User = get_user_model()


class CadenceTests(APITestCase):
    def test_add_months_clamps_to_short_months(self):
        self.assertEqual(add_months(date(2026, 1, 31), 1), date(2026, 2, 28))
        self.assertEqual(add_months(date(2024, 11, 30), 3), date(2025, 2, 28))
        self.assertEqual(add_months(date(2026, 6, 10), 3), date(2026, 9, 10))


class PersonApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        # Seeded by the 0004 migration's preset backfill, not test fixtures —
        # get_or_create so a test DB rebuilt without that migration history
        # (or run twice) doesn't collide on the unique name.
        self.alumni, _ = RelationshipTag.objects.get_or_create(name="Alumni")
        self.university_event, _ = MetSourceTag.objects.get_or_create(name="University event")

    def test_next_chat_defaults_to_last_meeting_plus_three_months(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "Sarah Chen",
                "relationship": self.alumni.id,
                "source": self.university_event.id,
                "status": "connection",
                "companies": [self.company.id],
                "last_meeting_at": "2026-06-10",
                "contacts": [
                    {"channel": "linkedin", "value": "https://linkedin.com/in/sarah", "is_preferred": True},
                    {"channel": "email", "value": "sarah@example.com", "is_preferred": False},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["next_chat_at"], "2026-09-10")
        self.assertEqual(len(response.data["contact_methods"]), 2)
        self.assertEqual(response.data["preferred_contact_display"]["channel"], "linkedin")

    def test_explicit_next_chat_is_never_overwritten(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "Sarah Chen",
                "last_meeting_at": "2026-06-10",
                "next_chat_at": "2026-07-01",
            },
            format="json",
        )
        self.assertEqual(response.data["next_chat_at"], "2026-07-01")

        person = Person.objects.get(id=response.data["id"])
        patched = self.client.patch(
            f"/api/people/{person.id}/", {"title": "Consultant"}, format="json"
        )
        self.assertEqual(patched.data["next_chat_at"], "2026-07-01")

    def test_next_chat_cannot_precede_last_meeting(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "Sarah Chen",
                "last_meeting_at": "2026-06-10",
                "next_chat_at": "2026-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("next_chat_at", response.data)

    def test_log_meeting_rolls_the_cadence_forward(self):
        person = Person.objects.create(
            user=self.user, full_name="Sarah Chen", last_meeting_at=date(2026, 1, 1)
        )
        response = self.client.post(
            f"/api/people/{person.id}/log-meeting/",
            {"met_on": "2026-06-10"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["last_meeting_at"], "2026-06-10")
        self.assertEqual(response.data["next_chat_at"], "2026-09-10")

    def test_duplicate_person_name_per_user_is_rejected(self):
        Person.objects.create(user=self.user, full_name="Sarah Chen")
        response = self.client.post(
            "/api/people/", {"full_name": "sarah chen"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("full_name", response.data)

        # …but two users may each track someone by that name.
        self.assertTrue(Person.objects.create(user=self.other, full_name="Sarah Chen").pk)

    def test_people_are_scoped_to_the_owner(self):
        Person.objects.create(user=self.other, full_name="Not Mine")
        mine = Person.objects.create(user=self.user, full_name="Mine")
        response = self.client.get("/api/people/")
        self.assertEqual([row["id"] for row in response.data], [mine.id])

    def test_due_filter_finds_overdue_chats(self):
        Person.objects.create(
            user=self.user, full_name="Overdue", next_chat_at=date(2020, 1, 1)
        )
        Person.objects.create(
            user=self.user, full_name="Later", next_chat_at=date(2099, 1, 1)
        )
        response = self.client.get("/api/people/", {"due": "overdue"})
        self.assertEqual([row["full_name"] for row in response.data], ["Overdue"])

    def test_contacts_are_replaced_wholesale_on_update(self):
        person = Person.objects.create(user=self.user, full_name="Sarah Chen")
        ContactMethod.objects.create(person=person, channel="phone", value="0400")

        self.client.patch(
            f"/api/people/{person.id}/",
            {"contacts": [{"channel": "email", "value": "s@example.com", "is_preferred": True}]},
            format="json",
        )
        self.assertEqual(
            list(person.contact_methods.values_list("channel", flat=True)), ["email"]
        )


class CustomCadenceTests(APITestCase):
    """FR-NET-10's default is 3 months, but that's a global fallback, not a
    rule every contact has to share."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)

    def test_custom_cadence_overrides_the_three_month_default(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "Monthly Mentor",
                "status": "connection",
                "cadence_months": 1,
                "last_meeting_at": "2026-06-10",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["next_chat_at"], "2026-07-10")

    def test_blank_cadence_still_falls_back_to_three_months(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "Default Cadence",
                "status": "connection",
                "last_meeting_at": "2026-06-10",
            },
            format="json",
        )
        self.assertEqual(response.data["next_chat_at"], "2026-09-10")

    def test_cadence_applies_on_log_meeting_too(self):
        person = Person.objects.create(
            user=self.user, full_name="Yearly Contact", cadence_months=12
        )
        response = self.client.post(
            f"/api/people/{person.id}/log-meeting/",
            {"met_on": "2026-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["next_chat_at"], "2027-01-01")


class NeverScheduleCadenceTests(APITestCase):
    """A frequency of 0 means "don't set a catch-up" — plenty of contacts
    belong in the network without a recurring reminder."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)

    def test_never_derives_no_next_chat(self):
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "No Reminders",
                "status": "connection",
                "cadence_months": 0,
                "last_meeting_at": "2026-06-10",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["next_chat_at"])

    def test_logging_a_meeting_still_schedules_nothing(self):
        person = Person.objects.create(
            user=self.user, full_name="Quiet Contact", cadence_months=0
        )
        response = self.client.post(
            f"/api/people/{person.id}/log-meeting/", {"met_on": "2026-01-01"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["last_meeting_at"], "2026-01-01")
        self.assertIsNone(response.data["next_chat_at"])

    def test_switching_to_never_clears_an_existing_reminder(self):
        person = Person.objects.create(
            user=self.user, full_name="Was Scheduled", last_meeting_at=date(2026, 6, 10)
        )
        person.apply_cadence_default()
        person.save()
        self.assertIsNotNone(person.next_chat_at)

        response = self.client.patch(
            f"/api/people/{person.id}/", {"cadence_months": 0}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["next_chat_at"])

    def test_switching_to_never_clears_it_even_when_the_form_echoes_the_date(self):
        """What the edit form actually posts: the whole person, including the
        next-chat date it loaded. That must still count as switching off."""
        person = Person.objects.create(
            user=self.user, full_name="Form Echo", last_meeting_at=date(2026, 6, 10)
        )
        person.apply_cadence_default()
        person.save()
        scheduled = person.next_chat_at

        response = self.client.patch(
            f"/api/people/{person.id}/",
            {"cadence_months": 0, "next_chat_at": scheduled.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["next_chat_at"])

    def test_a_date_changed_in_the_same_save_still_wins(self):
        person = Person.objects.create(
            user=self.user, full_name="Retimed", last_meeting_at=date(2026, 6, 10)
        )
        person.apply_cadence_default()
        person.save()

        response = self.client.patch(
            f"/api/people/{person.id}/",
            {"cadence_months": 0, "next_chat_at": "2026-11-20"},
            format="json",
        )
        self.assertEqual(response.data["next_chat_at"], "2026-11-20")

    def test_an_explicit_date_still_wins_over_never(self):
        """Naming a date is a deliberate act — "never auto-schedule" shouldn't
        throw away a follow-up the user typed in themselves."""
        response = self.client.post(
            "/api/people/",
            {
                "full_name": "One Off",
                "status": "connection",
                "cadence_months": 0,
                "last_meeting_at": "2026-06-10",
                "next_chat_at": "2026-08-01",
            },
            format="json",
        )
        self.assertEqual(response.data["next_chat_at"], "2026-08-01")

    def test_never_survives_a_round_trip(self):
        person = Person.objects.create(
            user=self.user, full_name="Stays Off", cadence_months=0
        )
        response = self.client.get(f"/api/people/{person.id}/")
        self.assertEqual(response.data["cadence_months"], 0)


class RelationshipSourceCatalogTests(APITestCase):
    """FR-NET-20 — relationship and "met via" are addable catalogs now, the
    same ensure-by-name pattern as Industry/Role, not a fixed enum."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)

    def test_presets_survived_the_conversion(self):
        response = self.client.get("/api/relationships/")
        names = {row["name"] for row in response.data}
        self.assertIn("Mentor", names)
        self.assertIn("Recruiter", names)

        response = self.client.get("/api/met-sources/")
        names = {row["name"] for row in response.data}
        self.assertIn("Referral", names)
        self.assertIn("LinkedIn", names)

    def test_a_brand_new_relationship_can_be_created_and_reused(self):
        created = self.client.post("/api/relationships/ensure/", {"name": "Hackathon buddy"})
        self.assertEqual(created.status_code, 201, created.data)

        response = self.client.post(
            "/api/people/",
            {"full_name": "Jordan Lee", "relationship": created.data["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["relationship_display"], "Hackathon buddy")

    def test_ensure_is_idempotent_by_name(self):
        first = self.client.post("/api/met-sources/ensure/", {"name": "Slack community"})
        second = self.client.post("/api/met-sources/ensure/", {"name": "slack community"})
        self.assertEqual(first.data["id"], second.data["id"])

    def test_relationship_and_source_are_optional(self):
        response = self.client.post("/api/people/", {"full_name": "No Tags Yet"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["relationship"])
        self.assertIsNone(response.data["source"])


class GlobalSearchTests(APITestCase):
    """The network search box is meant to find someone by whatever detail
    you actually remember about them — not just their name."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.recruiter, _ = RelationshipTag.objects.get_or_create(name="Recruiter")
        self.linkedin_source, _ = MetSourceTag.objects.get_or_create(name="LinkedIn")

    def test_search_matches_met_via(self):
        Person.objects.create(
            user=self.user, full_name="Jamie Lin", source=self.linkedin_source
        )
        response = self.client.get("/api/people/", {"search": "linkedin"})
        self.assertEqual([p["full_name"] for p in response.data], ["Jamie Lin"])

    def test_search_matches_relationship(self):
        Person.objects.create(
            user=self.user, full_name="Priya Rao", relationship=self.recruiter
        )
        response = self.client.get("/api/people/", {"search": "recruiter"})
        self.assertEqual([p["full_name"] for p in response.data], ["Priya Rao"])

    def test_search_matches_a_contact_detail(self):
        person = Person.objects.create(user=self.user, full_name="Alex Kim")
        ContactMethod.objects.create(
            person=person, channel="email", value="alex.kim@example.com", is_preferred=True
        )
        response = self.client.get("/api/people/", {"search": "alex.kim@example"})
        self.assertEqual([p["full_name"] for p in response.data], ["Alex Kim"])
