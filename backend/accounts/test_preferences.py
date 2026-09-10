"""Per-account preferences: appearance, celebrations, dashboard layout.

The point of these living on the profile rather than in localStorage is that
two people sharing a browser must not share a look — so what's covered here
is the round trip and, above all, the isolation between accounts.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class PreferencesApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_appearance_round_trips(self):
        response = self.client.patch(
            "/api/auth/me/",
            {
                "theme_mode": "intern",
                "color_preset": "rouge",
                "font_family": "jetbrains",
                "wallpaper": "city",
                "wallpaper_blur": 12,
                "wallpaper_opacity": 60,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["theme_mode"], "intern")
        self.assertEqual(response.data["color_preset"], "rouge")
        self.assertEqual(response.data["wallpaper_blur"], 12)

    def test_celebrations_is_null_until_chosen(self):
        response = self.client.get("/api/auth/me/")
        self.assertIsNone(response.data["celebrations_enabled"])

    def test_celebrations_round_trips_false(self):
        """False has to survive as False — a plain falsy check would drop it
        back to the frontend default and silently re-enable the effect."""
        self.client.patch(
            "/api/auth/me/", {"celebrations_enabled": False}, format="json"
        )
        response = self.client.get("/api/auth/me/")
        self.assertIs(response.data["celebrations_enabled"], False)

    def test_dashboard_layout_round_trips(self):
        layout = {"order": ["focus", "quote"], "hidden": ["map"], "spans": {"focus": 2}}
        self.client.patch("/api/auth/me/", {"dashboard_layout": layout}, format="json")
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.data["dashboard_layout"], layout)

    def test_preferences_do_not_leak_between_accounts(self):
        self.client.patch(
            "/api/auth/me/",
            {"theme_mode": "intern", "celebrations_enabled": False},
            format="json",
        )
        self.client.force_authenticate(self.other)
        response = self.client.get("/api/auth/me/")
        # Empty string for a user whose Profile row exists, None for one whose
        # doesn't yet (it's created on demand) — either way it reads as "never
        # picked", which is what the client treats as "use the default".
        self.assertFalse(response.data["theme_mode"])
        self.assertIsNone(response.data["celebrations_enabled"])
        self.assertIsNone(response.data["dashboard_layout"])
