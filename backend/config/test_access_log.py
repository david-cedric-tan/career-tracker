"""The access log has to name the caller, or it answers the wrong question."""

from django.contrib.auth.models import User
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from rest_framework.authtoken.models import Token

from config.access_log import AccessLogMiddleware, _client_ip


class ClientIpTests(SimpleTestCase):
    def test_prefers_the_first_forwarded_address(self):
        request = RequestFactory().get(
            "/api/todos/",
            HTTP_X_FORWARDED_FOR="192.168.5.42, 10.0.0.1",
            REMOTE_ADDR="10.0.0.1",
        )
        self.assertEqual(_client_ip(request), "192.168.5.42")

    def test_falls_back_to_the_socket_address(self):
        request = RequestFactory().get("/api/todos/", REMOTE_ADDR="192.168.5.28")
        self.assertEqual(_client_ip(request), "192.168.5.28")


@override_settings(API_ACCESS_LOG=True, API_ACCESS_LOG_COLOR="never")
class AccessLogTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.token = Token.objects.create(user=self.user)

    def test_logs_the_authenticated_user_behind_a_token(self):
        with self.assertLogs("api.access", level="INFO") as captured:
            response = self.client.get(
                "/api/todos/", HTTP_AUTHORIZATION=f"Token {self.token.key}"
            )
        self.assertEqual(response.status_code, 200)
        line = captured.output[0]
        self.assertIn(f"dave#{self.user.pk}", line)
        self.assertIn("/api/todos/", line)
        self.assertIn("GET", line)

    def test_marks_an_unauthenticated_call_as_anonymous(self):
        with self.assertLogs("api.access", level="INFO") as captured:
            self.client.get("/api/todos/")
        self.assertIn("anonymous", captured.output[0])

    def test_never_logs_credentials_from_a_login(self):
        with self.assertLogs("api.access", level="INFO") as captured:
            self.client.post(
                "/api/auth/login/",
                {"username": "dave", "password": "tracker-pass-9182"},
                format="json",
                content_type="application/json",
            )
        line = captured.output[0]
        self.assertNotIn("tracker-pass-9182", line)
        self.assertNotIn(self.token.key, line)

    def test_skips_paths_outside_the_api(self):
        with self.assertNoLogs("api.access", level="INFO"):
            self.client.get("/admin/")

    @override_settings(API_ACCESS_LOG=False)
    def test_can_be_switched_off_entirely(self):
        from django.core.exceptions import MiddlewareNotUsed

        with self.assertRaises(MiddlewareNotUsed):
            AccessLogMiddleware(lambda request: None)
