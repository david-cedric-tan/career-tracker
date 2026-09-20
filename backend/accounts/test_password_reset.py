"""Forgot-my-password: an anonymous request that the operator answers."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import PasswordResetRequest

U = get_user_model()
URL = "/api/auth/password-reset-requests/"


class PasswordResetRequestTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("mia", password="tracker-pass-9182")
        self.admin = U.objects.create_superuser("admin", password="tracker-pass-9182")

    def test_a_known_username_queues_one_request(self):
        r = self.client.post(URL, {"username": "MIA", "message": "locked out"}, format="json")
        self.assertEqual(r.status_code, 202, r.data)
        row = PasswordResetRequest.objects.get()
        self.assertEqual(row.user, self.user)
        self.assertEqual(row.message, "locked out")
        # Asking again while it's open doesn't queue a second one.
        self.client.post(URL, {"username": "mia"}, format="json")
        self.assertEqual(PasswordResetRequest.objects.count(), 1)

    def test_an_unknown_username_looks_identical(self):
        r = self.client.post(URL, {"username": "nobody"}, format="json")
        self.assertEqual(r.status_code, 202)
        self.assertEqual(PasswordResetRequest.objects.count(), 0)

    def test_a_blank_username_is_rejected(self):
        self.assertEqual(self.client.post(URL, {"username": "  "}, format="json").status_code, 400)

    def test_the_operator_sees_it_and_setting_a_password_clears_it(self):
        self.client.post(URL, {"username": "mia", "message": "help"}, format="json")

        self.client.force_authenticate(self.admin)
        queue = self.client.get("/api/console/password-resets/")
        self.assertEqual([row["username"] for row in queue.data], ["mia"])
        self.assertEqual(queue.data[0]["message"], "help")
        overview = self.client.get("/api/console/overview/")
        self.assertEqual(overview.data["totals"]["password_resets"], 1)
        account = next(
            row for row in self.client.get("/api/console/accounts/").data if row["username"] == "mia"
        )
        self.assertIsNotNone(account["password_reset_requested_at"])

        r = self.client.patch(
            f"/api/console/accounts/{self.user.id}/", {"password": "new-pass-9182"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNone(r.data["password_reset_requested_at"])
        self.assertEqual(self.client.get("/api/console/password-resets/").data, [])
        row = PasswordResetRequest.objects.get()
        self.assertEqual(row.resolved_by, self.admin)
        self.assertIsNotNone(row.resolved_at)

    def test_the_queue_is_superuser_only(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/console/password-resets/").status_code, 403)
