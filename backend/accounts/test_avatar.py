"""Profile picture upload (FR-AUTH-03)."""

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


def image_file(name="me.png", size=(900, 1400), fmt="PNG", colour=(200, 80, 20)):
    buffer = BytesIO()
    Image.new("RGB", size, colour).save(buffer, format=fmt)
    buffer.seek(0)
    return SimpleUploadedFile(
        name, buffer.read(), content_type=f"image/{fmt.lower()}"
    )


@override_settings(MEDIA_ROOT=MEDIA)
class AvatarApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_upload_returns_an_absolute_url_and_squares_the_image(self):
        response = self.client.post(
            "/api/auth/me/avatar/", {"avatar": image_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["avatar"].startswith("http"))

        profile = Profile.objects.get(user=self.user)
        with Image.open(profile.avatar.path) as saved:
            self.assertEqual(saved.width, saved.height)
            self.assertLessEqual(saved.width, 512)

    def test_me_exposes_the_avatar(self):
        self.client.post(
            "/api/auth/me/avatar/", {"avatar": image_file()}, format="multipart"
        )
        response = self.client.get("/api/auth/me/")
        self.assertIsNotNone(response.data["avatar"])

    def test_avatar_is_null_until_one_is_uploaded(self):
        response = self.client.get("/api/auth/me/")
        self.assertIsNone(response.data["avatar"])

    def test_replacing_an_avatar_removes_the_old_file_and_changes_the_url(self):
        self.client.post(
            "/api/auth/me/avatar/", {"avatar": image_file()}, format="multipart"
        )
        first = Profile.objects.get(user=self.user).avatar.path

        self.client.post(
            "/api/auth/me/avatar/",
            {"avatar": image_file(name="new.png", colour=(20, 80, 200))},
            format="multipart",
        )
        second = Profile.objects.get(user=self.user).avatar.path

        # A new path, so browsers can't serve the previous picture from cache…
        self.assertNotEqual(first, second)
        # …and the superseded file is gone rather than orphaned in MEDIA_ROOT.
        self.assertFalse(os.path.exists(first))
        self.assertTrue(os.path.exists(second))

    def test_delete_clears_it(self):
        self.client.post(
            "/api/auth/me/avatar/", {"avatar": image_file()}, format="multipart"
        )
        response = self.client.delete("/api/auth/me/avatar/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["avatar"])

    def test_non_image_is_rejected(self):
        bogus = SimpleUploadedFile("resume.pdf", b"%PDF-1.4 not an image", "application/pdf")
        response = self.client.post(
            "/api/auth/me/avatar/", {"avatar": bogus}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("avatar", response.data)

    @override_settings(MEDIA_ROOT=MEDIA, MAX_UPLOAD_IMAGE_BYTES=1024)
    def test_oversized_image_is_rejected(self):
        response = self.client.post(
            "/api/auth/me/avatar/",
            {"avatar": image_file(size=(1200, 1200))},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("avatar", response.data)

    def test_avatar_upload_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            "/api/auth/me/avatar/", {"avatar": image_file()}, format="multipart"
        )
        self.assertEqual(response.status_code, 401)
