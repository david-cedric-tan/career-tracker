from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Application, AppsEventLog, Company, EventType, Stage
from applications.services import log_creation, log_transition

U = get_user_model()


class EventEditingTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.other = U.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.app = Application.objects.create(user=self.user, company=self.company)
        log_creation(self.app)
        self.app.stage = Stage.ONLINE_ASSESSMENT
        self.app.save(update_fields=["stage"])
        self.move = log_transition(self.app, Stage.APPLIED, self.app.outcome, note="OA sent")

    def url(self, event):
        return f"/api/applications/{self.app.id}/events/{event.id}/"

    def test_correcting_the_date(self):
        r = self.client.patch(self.url(self.move), {"changed_at": "2026-03-01"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.move.refresh_from_db()
        self.assertEqual(self.move.changed_at.date().isoformat(), "2026-03-01")

    def test_correcting_the_note(self):
        r = self.client.patch(self.url(self.move), {"note": "  Actually a HireVue "}, format="json")
        self.assertEqual(r.status_code, 200)
        self.move.refresh_from_db()
        self.assertEqual(self.move.note, "Actually a HireVue")

    def test_deleting_a_mistaken_row(self):
        r = self.client.delete(self.url(self.move))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(AppsEventLog.objects.filter(pk=self.move.pk).exists())

    def test_the_creation_row_cannot_be_deleted(self):
        created = self.app.event_logs.get(event_type=EventType.CREATED)
        r = self.client.delete(self.url(created))
        self.assertEqual(r.status_code, 400)
        self.assertTrue(AppsEventLog.objects.filter(pk=created.pk).exists())

    def test_a_clashing_timestamp_is_nudged_not_rejected(self):
        created = self.app.event_logs.get(event_type=EventType.CREATED)
        stamp = created.changed_at.isoformat()
        r = self.client.patch(self.url(self.move), {"changed_at": stamp}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_another_users_event_is_unreachable(self):
        self.client.force_authenticate(self.other)
        theirs = Application.objects.create(user=self.other, company=self.company)
        r = self.client.patch(
            f"/api/applications/{theirs.id}/events/{self.move.id}/",
            {"note": "hijacked"},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.move.refresh_from_db()
        self.assertEqual(self.move.note, "OA sent")

    def test_time_of_day_is_stored_not_just_the_date(self):
        """The timeline sorts on the full timestamp, so the clock time is what
        lets two events on one day be put in the right order."""
        r = self.client.patch(
            self.url(self.move),
            {"changed_at": "2026-03-01T14:30:00.000Z"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.move.refresh_from_db()
        self.assertEqual(self.move.changed_at.isoformat(), "2026-03-01T14:30:00+00:00")

    def test_reordering_two_events_on_the_same_day(self):
        created = self.app.event_logs.get(event_type=EventType.CREATED)
        self.client.patch(
            self.url(created), {"changed_at": "2026-03-01T09:00:00.000Z"}, format="json"
        )
        self.client.patch(
            self.url(self.move), {"changed_at": "2026-03-01T11:00:00.000Z"}, format="json"
        )
        order = list(
            self.app.event_logs.order_by("changed_at").values_list("event_type", flat=True)
        )
        self.assertEqual(order, [EventType.CREATED, EventType.STAGE])

    def test_editing_a_waiting_row_moves_awaiting_since_too(self):
        """The badge reads `awaiting_since`; the timeline reads the log row.

        Correcting the row has to move both, or the badge goes on quoting the
        moment the box was ticked rather than when the stage really finished.
        """
        self.client.post(
            f"/api/applications/{self.app.id}/waiting/", {"waiting": True}, format="json"
        )
        waiting = self.app.event_logs.get(event_type="waiting_started")

        r = self.client.patch(
            f"/api/applications/{self.app.id}/events/{waiting.id}/",
            {"changed_at": "2026-08-28T03:30:00.000Z"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.app.refresh_from_db()
        self.assertEqual(
            self.app.awaiting_since.isoformat(), "2026-08-28T03:30:00+00:00"
        )

    def test_deleting_the_waiting_row_clears_the_flag(self):
        self.client.post(
            f"/api/applications/{self.app.id}/waiting/", {"waiting": True}, format="json"
        )
        waiting = self.app.event_logs.get(event_type="waiting_started")

        r = self.client.delete(f"/api/applications/{self.app.id}/events/{waiting.id}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.app.refresh_from_db()
        self.assertFalse(self.app.awaiting_response)
        self.assertIsNone(self.app.awaiting_since)

    def test_waiting_row_can_retarget_its_stage(self):
        self.client.post(
            f"/api/applications/{self.app.id}/waiting/",
            {"waiting": True, "stage": Stage.VIDEO_INTERVIEW},
            format="json",
        )
        waiting = self.app.event_logs.get(event_type="waiting_started")
        r = self.client.patch(
            f"/api/applications/{self.app.id}/events/{waiting.id}/",
            {"stage": Stage.ONLINE_ASSESSMENT},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        waiting.refresh_from_db()
        self.assertEqual(waiting.curr_stage, Stage.ONLINE_ASSESSMENT)

    def test_rejects_an_unparseable_date(self):
        r = self.client.patch(self.url(self.move), {"changed_at": "nonsense"}, format="json")
        self.assertEqual(r.status_code, 400)
