"""Editing an application is recorded, not just stage/outcome moves."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import (
    Application,
    ApplicationJobListing,
    AppsEventLog,
    Company,
    EventType,
    JobListing,
    Outcome,
    Resume,
    Role,
    Stage,
)
from .services import log_creation

User = get_user_model()


class EditLogTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.role = Role.objects.create(name="Vacationer")
        self.listing = JobListing.objects.create(company=self.company, role=self.role)
        self.resume = Resume.objects.create(user=self.user, label="ey-vac-2026")

        self.application = Application.objects.create(
            user=self.user, company=self.company, notes="First pass."
        )
        log_creation(self.application)

    def logs(self):
        return AppsEventLog.objects.filter(application=self.application).order_by(
            "changed_at"
        )

    def test_editing_notes_writes_an_edited_row(self):
        response = self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"notes": "Rewrote after the OA."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

        log = self.logs().last()
        self.assertEqual(log.event_type, EventType.EDITED)
        self.assertEqual([c["field"] for c in log.changes], ["notes"])
        self.assertEqual(log.changes[0]["from"], "First pass.")
        self.assertEqual(log.changes[0]["to"], "Rewrote after the OA.")

    def test_edit_appears_in_the_patch_response_history(self):
        response = self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"source": "Referral"},
            format="json",
        )
        types = [log["event_type"] for log in response.data["event_logs"]]
        self.assertIn(EventType.EDITED, types)

    def test_several_fields_land_in_one_row(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {
                "source": "LinkedIn",
                "follow_up_date": "2026-10-01",
                "resume": self.resume.id,
            },
            format="json",
        )
        log = self.logs().last()
        self.assertEqual(log.event_type, EventType.EDITED)
        self.assertEqual(
            {c["field"] for c in log.changes},
            {"source", "follow_up_date", "resume"},
        )
        # Values are rendered for display, not raw ids.
        resume_change = next(c for c in log.changes if c["field"] == "resume")
        self.assertEqual(resume_change["to"], "ey-vac-2026")

    def test_changing_roles_is_recorded(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"listing_ids": [self.listing.id]},
            format="json",
        )
        log = self.logs().last()
        change = next(c for c in log.changes if c["field"] == "roles")
        self.assertIsNone(change["from"])
        self.assertEqual(change["to"], "Vacationer")

    def test_a_stage_move_carries_its_field_edits_in_the_same_row(self):
        before = self.logs().count()
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"stage": Stage.ONLINE_ASSESSMENT, "source": "Referral"},
            format="json",
        )
        # One row, not two: the save is a single event.
        self.assertEqual(self.logs().count(), before + 1)

        log = self.logs().last()
        self.assertEqual(log.event_type, EventType.STAGE)
        self.assertEqual(log.curr_stage, Stage.ONLINE_ASSESSMENT)
        self.assertEqual([c["field"] for c in log.changes], ["source"])

    def test_outcome_only_change_is_typed_as_outcome(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"outcome": Outcome.REJECTED},
            format="json",
        )
        self.assertEqual(self.logs().last().event_type, EventType.OUTCOME)

    def test_saving_without_changes_writes_nothing(self):
        before = self.logs().count()
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"notes": "First pass.", "stage": self.application.stage},
            format="json",
        )
        self.assertEqual(self.logs().count(), before)

    def test_creation_row_is_typed(self):
        self.assertEqual(self.logs().first().event_type, EventType.CREATED)

    def test_edits_reach_the_dashboard_activity_feed(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"notes": "New notes", "source": "Referral"},
            format="json",
        )
        response = self.client.get("/api/dashboard/activity/")
        edited = [r for r in response.data if r["event_type"] == EventType.EDITED]
        self.assertTrue(edited)
        self.assertIn("EY: updated", edited[0]["summary"])
        self.assertIn("target_url", edited[0])

    def test_stage_move_with_edits_notes_them_in_the_feed(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"stage": Stage.OFFER, "source": "Referral"},
            format="json",
        )
        response = self.client.get("/api/dashboard/activity/")
        row = next(r for r in response.data if r["event_type"] == EventType.STAGE)
        self.assertIn("Also updated source", row["note"])

    def test_edits_do_not_count_as_stage_advances(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"notes": "Nothing to do with the pipeline"},
            format="json",
        )
        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "week", "buckets": 4}
        )
        self.assertEqual(response.data["buckets"][-1]["stage_advances"], 0)

    def test_per_listing_rows_survive_an_unrelated_edit(self):
        ApplicationJobListing.objects.create(
            application=self.application, job_listing=self.listing
        )
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"notes": "Untouched roles"},
            format="json",
        )
        self.assertEqual(self.application.listing_links.count(), 1)

    def test_a_note_does_not_hide_the_field_edits_in_the_feed(self):
        self.client.patch(
            f"/api/applications/{self.application.id}/",
            {
                "stage": Stage.OFFER,
                "source": "Referral",
                "event_note": "Offer call booked",
            },
            format="json",
        )
        response = self.client.get("/api/dashboard/activity/")
        row = next(r for r in response.data if r["event_type"] == EventType.STAGE)
        self.assertIn("Offer call booked", row["note"])
        self.assertIn("Also updated source", row["note"])

    def test_reapply_reminder_is_editable_and_logged(self):
        response = self.client.patch(
            f"/api/applications/{self.application.id}/",
            {"outcome": Outcome.REJECTED, "reapply_at": "2027-01-15"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["reapply_at"], "2027-01-15")

        log = self.logs().last()
        self.assertEqual(log.event_type, EventType.OUTCOME)
        change = next(c for c in log.changes if c["field"] == "reapply_at")
        self.assertEqual(change["to"], "2027-01-15")
