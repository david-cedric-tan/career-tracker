from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Application, Company, Outcome, Stage
from applications.services import log_creation

U = get_user_model()


class WaitingStateTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="CommBank")
        self.app = Application.objects.create(
            user=self.user, company=self.company, stage=Stage.VIDEO_INTERVIEW
        )
        log_creation(self.app)

    def mark_waiting(self, waiting=True):
        return self.client.post(
            f"/api/applications/{self.app.id}/waiting/", {"waiting": waiting}, format="json"
        )

    def events(self):
        return [e["event_type"] for e in self.client.get(f"/api/applications/{self.app.id}/").data["event_logs"]]

    def test_marking_waiting_changes_neither_stage_nor_outcome(self):
        r = self.mark_waiting()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["awaiting_response"])
        self.assertIsNotNone(r.data["awaiting_since"])
        # The whole point: it is not a stage and not an outcome.
        self.assertEqual(r.data["stage"], Stage.VIDEO_INTERVIEW)
        self.assertEqual(r.data["outcome"], Outcome.IN_PROGRESS)
        self.assertIn("waiting_started", self.events())

    def test_moving_stage_clears_waiting_and_logs_the_end(self):
        self.mark_waiting()
        r = self.client.post(
            f"/api/applications/{self.app.id}/advance/",
            {"stage": Stage.FINAL_INTERVIEW},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(r.data["awaiting_response"])
        self.assertIsNone(r.data["awaiting_since"])
        self.assertIn("waiting_ended", self.events())

    def test_terminal_outcome_clears_waiting(self):
        self.mark_waiting()
        r = self.client.post(
            f"/api/applications/{self.app.id}/advance/",
            {"outcome": Outcome.REJECTED},
            format="json",
        )
        self.assertFalse(r.data["awaiting_response"])
        self.assertIn("waiting_ended", self.events())

    def test_editing_an_unrelated_field_leaves_waiting_alone(self):
        self.mark_waiting()
        r = self.client.patch(
            f"/api/applications/{self.app.id}/", {"source": "Referral"}, format="json"
        )
        self.assertTrue(r.data["awaiting_response"])

    def test_awaiting_days_is_reported(self):
        self.mark_waiting()
        self.app.refresh_from_db()
        self.app.awaiting_since = self.app.awaiting_since - timedelta(days=40)
        self.app.save(update_fields=["awaiting_since"])
        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertEqual(r.data["awaiting_days"], 40)

    def test_never_auto_ghosts(self):
        """A long wait is a prompt, not a verdict."""
        self.mark_waiting()
        self.app.refresh_from_db()
        self.app.awaiting_since = self.app.awaiting_since - timedelta(days=200)
        self.app.save(update_fields=["awaiting_since"])
        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertEqual(r.data["outcome"], Outcome.IN_PROGRESS)
        self.assertTrue(r.data["awaiting_response"])

    def test_marking_done_at_a_past_time(self):
        """Friday's interview logged on Monday keeps Friday's timestamp."""
        r = self.client.post(
            f"/api/applications/{self.app.id}/waiting/",
            {"waiting": True, "changed_at": "2026-08-28T14:30:00.000Z", "note": "Went well"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["awaiting_since"].replace("Z", "+00:00"),
                         "2026-08-28T14:30:00+00:00")
        row = next(e for e in r.data["event_logs"] if e["event_type"] == "waiting_started")
        self.assertEqual(row["note"], "Went well")
        self.assertTrue(row["changed_at"].startswith("2026-08-28T14:30"))

    def test_rejects_an_unparseable_timestamp(self):
        r = self.client.post(
            f"/api/applications/{self.app.id}/waiting/",
            {"waiting": True, "changed_at": "whenever"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_marking_waiting_twice_does_not_double_log(self):
        self.mark_waiting()
        self.mark_waiting()
        self.assertEqual(self.events().count("waiting_started"), 1)


class HistoricalBackfillTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        # Entered today, but it all actually happened months ago.
        self.app = Application.objects.create(
            user=self.user, company=self.company, applied_at=date.today()
        )
        log_creation(self.app)

    def backfill(self, moves):
        return self.client.post(
            f"/api/applications/{self.app.id}/backfill/", {"moves": moves}, format="json"
        )

    def test_past_moves_are_accepted_and_pull_the_applied_date_back(self):
        """This used to 400: every move predated the applied date."""
        r = self.backfill([
            {"stage": Stage.ONLINE_ASSESSMENT, "changed_at": "2026-03-01"},
            {"stage": Stage.VIDEO_INTERVIEW, "changed_at": "2026-03-14"},
        ])
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["is_historical"])
        # Earliest move isn't the act of applying, so a week is allowed for it.
        self.assertEqual(r.data["applied_at"], "2026-02-22")

    def test_applied_as_the_earliest_move_dates_it_exactly(self):
        r = self.backfill([
            {"stage": Stage.APPLIED, "changed_at": "2026-03-01"},
            {"stage": Stage.ONLINE_ASSESSMENT, "changed_at": "2026-03-08"},
        ])
        self.assertEqual(r.data["applied_at"], "2026-03-01")

    def test_out_of_order_moves_are_still_rejected(self):
        r = self.backfill([
            {"stage": Stage.VIDEO_INTERVIEW, "changed_at": "2026-03-14"},
            {"stage": Stage.ONLINE_ASSESSMENT, "changed_at": "2026-03-01"},
        ])
        self.assertEqual(r.status_code, 400)

    def test_an_earlier_applied_date_is_never_pushed_forward(self):
        self.app.applied_at = date(2025, 1, 1)
        self.app.save(update_fields=["applied_at"])
        r = self.backfill([{"stage": Stage.ONLINE_ASSESSMENT, "changed_at": "2026-03-01"}])
        self.assertEqual(r.data["applied_at"], "2025-01-01")


class AwaitingFilterTests(APITestCase):
    """The dashboard's amber slice deep-links here."""

    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        company = Company.objects.create(name="EY")
        self.waiting = Application.objects.create(
            user=self.user, company=company, awaiting_response=True
        )
        self.other = Application.objects.create(user=self.user, company=company)

    def test_filters_to_waiting_applications(self):
        ids = [r["id"] for r in self.client.get("/api/applications/?awaiting=1").data]
        self.assertEqual(ids, [self.waiting.id])

    def test_absent_filter_returns_everything(self):
        ids = {r["id"] for r in self.client.get("/api/applications/").data}
        self.assertEqual(ids, {self.waiting.id, self.other.id})
