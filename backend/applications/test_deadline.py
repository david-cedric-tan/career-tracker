from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import (
    Application,
    ApplicationJobListing,
    Company,
    JobListing,
    Role,
)

U = get_user_model()


class ApplicationDeadlineTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.role = Role.objects.create(name="Vacationer")
        self.app = Application.objects.create(user=self.user, company=self.company)

    def listing(self, closing_at):
        listing = JobListing.objects.create(
            company=self.company, role=self.role, closing_at=closing_at
        )
        ApplicationJobListing.objects.create(application=self.app, job_listing=listing)
        return listing

    def deadline(self):
        return self.client.get(f"/api/applications/{self.app.id}/").data["deadline"]

    def test_no_listings_means_no_deadline(self):
        self.assertIsNone(self.deadline())

    def test_a_listing_without_a_closing_date_contributes_nothing(self):
        self.listing(None)
        self.assertIsNone(self.deadline())

    def test_the_soonest_closing_date_wins(self):
        self.listing(date.today() + timedelta(days=30))
        self.listing(date.today() + timedelta(days=5))
        self.assertEqual(self.deadline(), (date.today() + timedelta(days=5)).isoformat())

    def test_undated_listings_do_not_beat_dated_ones(self):
        self.listing(None)
        self.listing(date.today() + timedelta(days=9))
        self.assertEqual(self.deadline(), (date.today() + timedelta(days=9)).isoformat())

    def test_deadline_is_on_the_list_endpoint_too(self):
        self.listing(date.today() + timedelta(days=3))
        row = self.client.get("/api/applications/").data[0]
        self.assertEqual(row["deadline"], (date.today() + timedelta(days=3)).isoformat())


class OutcomeTimestampTests(APITestCase):
    """The badge hover needs to say when an outcome was decided."""

    def setUp(self):
        from applications.services import log_creation, log_transition
        from applications.models import Outcome, Stage

        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.app = Application.objects.create(user=self.user, company=self.company)
        log_creation(self.app)
        self._log_transition = log_transition
        self._Outcome = Outcome
        self._Stage = Stage

    def test_none_until_the_outcome_actually_moves(self):
        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertIsNone(r.data["outcome_changed_at"])

    def test_set_once_an_outcome_is_recorded(self):
        prev_outcome = self.app.outcome
        self.app.outcome = self._Outcome.REJECTED
        self.app.save(update_fields=["outcome"])
        self._log_transition(self.app, self.app.stage, prev_outcome)

        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertIsNotNone(r.data["outcome_changed_at"])

    def test_a_stage_move_alone_does_not_set_it(self):
        prev_stage = self.app.stage
        self.app.stage = self._Stage.ONLINE_ASSESSMENT
        self.app.save(update_fields=["stage"])
        self._log_transition(self.app, prev_stage, self.app.outcome)

        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertIsNone(r.data["outcome_changed_at"])
        self.assertIsNotNone(r.data["stage_updated_at"])
