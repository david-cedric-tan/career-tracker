"""Custom wallpaper upload + the onboarding flag."""

import os
import shutil
import tempfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import Profile

User = get_user_model()
MEDIA = tempfile.mkdtemp()


def image_file(name="photo.jpg", size=(3000, 1200)):
    """A wide landscape photo — the shape a background usually is."""
    buffer = BytesIO()
    Image.new("RGB", size, (30, 60, 90)).save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class WallpaperApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_upload_preserves_aspect_ratio(self):
        response = self.client.post(
            "/api/auth/me/wallpaper/", {"wallpaper": image_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["custom_wallpaper"].startswith("http"))

        profile = Profile.objects.get(user=self.user)
        with Image.open(profile.custom_wallpaper.path) as saved:
            # Contained, not cropped: a 2.5:1 wide photo stays 2.5:1, capped
            # at the wallpaper ceiling rather than a square or a fixed box.
            self.assertAlmostEqual(saved.width / saved.height, 3000 / 1200, places=2)
            self.assertLessEqual(saved.width, 1920)

    def test_wallpaper_is_null_until_uploaded(self):
        response = self.client.get("/api/auth/me/")
        self.assertIsNone(response.data["custom_wallpaper"])

    def test_replacing_removes_the_previous_file(self):
        self.client.post(
            "/api/auth/me/wallpaper/", {"wallpaper": image_file()}, format="multipart"
        )
        first = Profile.objects.get(user=self.user).custom_wallpaper.path

        self.client.post(
            "/api/auth/me/wallpaper/",
            {"wallpaper": image_file(name="second.jpg")},
            format="multipart",
        )
        second = Profile.objects.get(user=self.user).custom_wallpaper.path

        self.assertNotEqual(first, second)
        self.assertFalse(os.path.exists(first))
        self.assertTrue(os.path.exists(second))

    def test_delete_clears_it(self):
        self.client.post(
            "/api/auth/me/wallpaper/", {"wallpaper": image_file()}, format="multipart"
        )
        response = self.client.delete("/api/auth/me/wallpaper/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["custom_wallpaper"])

    def test_non_image_is_rejected(self):
        bogus = SimpleUploadedFile("notes.txt", b"hello", "text/plain")
        response = self.client.post(
            "/api/auth/me/wallpaper/", {"wallpaper": bogus}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("wallpaper", response.data)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            "/api/auth/me/wallpaper/", {"wallpaper": image_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 401)


class OnboardingFlagTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_defaults_to_incomplete(self):
        response = self.client.get("/api/auth/me/")
        self.assertFalse(response.data["onboarding_completed"])

    def test_can_be_marked_complete(self):
        response = self.client.patch(
            "/api/auth/me/", {"onboarding_completed": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["onboarding_completed"])

        # …and persists, so it stays dismissed on the next login.
        again = self.client.get("/api/auth/me/")
        self.assertTrue(again.data["onboarding_completed"])
