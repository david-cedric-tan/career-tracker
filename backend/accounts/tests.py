"""Auth flow checks (FR-AUTH-*)."""

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

User = get_user_model()


class AuthApiTests(APITestCase):
    payload = {
        "username": "dave",
        "email": "dave@example.com",
        "password": "tracker-pass-9182",
        "password_confirm": "tracker-pass-9182",
        "first_name": "Dave",
        "last_name": "Tan",
        "mobile_number": "0400 000 111",
        "linkedin_url": "https://linkedin.com/in/davetan",
    }

    def test_register_returns_a_token(self):
        response = self.client.post("/api/auth/register/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn("token", response.data)
        self.assertEqual(response.data["user"]["username"], "dave")
        self.assertTrue(Token.objects.filter(user__username="dave").exists())

    def test_mismatched_passwords_are_rejected(self):
        response = self.client.post(
            "/api/auth/register/",
            {**self.payload, "password_confirm": "something-else"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password_confirm", response.data)

    def test_weak_password_is_rejected(self):
        response = self.client.post(
            "/api/auth/register/",
            {**self.payload, "password": "12345", "password_confirm": "12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)

    def test_duplicate_username_and_email_are_rejected(self):
        self.client.post("/api/auth/register/", self.payload, format="json")

        dupe_user = self.client.post(
            "/api/auth/register/",
            {**self.payload, "email": "other@example.com"},
            format="json",
        )
        self.assertEqual(dupe_user.status_code, 400)
        self.assertIn("username", dupe_user.data)

        dupe_email = self.client.post(
            "/api/auth/register/",
            {**self.payload, "username": "someone-else"},
            format="json",
        )
        self.assertEqual(dupe_email.status_code, 400)
        self.assertIn("email", dupe_email.data)

    def test_login_logout_round_trip(self):
        User.objects.create_user("dave", password="tracker-pass-9182")

        login = self.client.post(
            "/api/auth/login/",
            {"username": "dave", "password": "tracker-pass-9182"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        token = login.data["token"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["username"], "dave")

        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 204)
        self.assertFalse(Token.objects.filter(key=token).exists())

    def test_bad_credentials_are_rejected(self):
        User.objects.create_user("dave", password="tracker-pass-9182")
        response = self.client.post(
            "/api/auth/login/",
            {"username": "dave", "password": "wrong"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_required_identity_fields_are_enforced(self):
        for missing in ("first_name", "last_name", "mobile_number", "linkedin_url"):
            payload = {**self.payload, missing: ""}
            response = self.client.post("/api/auth/register/", payload, format="json")
            self.assertEqual(response.status_code, 400, missing)
            self.assertIn(missing, response.data)

    def test_school_email_is_optional(self):
        response = self.client.post("/api/auth/register/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["user"]["school_email"], "")

    def test_registration_stores_profile_contact_fields(self):
        response = self.client.post(
            "/api/auth/register/",
            {**self.payload, "school_email": "dave@uni.edu"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        user_data = response.data["user"]
        self.assertEqual(user_data["mobile_number"], "0400 000 111")
        self.assertEqual(user_data["linkedin_url"], "https://linkedin.com/in/davetan")
        self.assertEqual(user_data["school_email"], "dave@uni.edu")

    def test_me_can_update_profile_contact_fields(self):
        self.client.post("/api/auth/register/", self.payload, format="json")
        self.client.login(username="dave", password="tracker-pass-9182")
        token_login = self.client.post(
            "/api/auth/login/",
            {"username": "dave", "password": "tracker-pass-9182"},
            format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token_login.data['token']}")

        response = self.client.patch(
            "/api/auth/me/",
            {"mobile_number": "0400 999 888", "linkedin_url": "https://linkedin.com/in/new"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["mobile_number"], "0400 999 888")
        self.assertEqual(response.data["linkedin_url"], "https://linkedin.com/in/new")

        # And a plain field update alongside it doesn't get lost.
        response = self.client.patch(
            "/api/auth/me/", {"first_name": "Updated"}, format="json"
        )
        self.assertEqual(response.data["first_name"], "Updated")
        self.assertEqual(response.data["mobile_number"], "0400 999 888")
