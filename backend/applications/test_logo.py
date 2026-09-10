"""Company logo upload — shared reference data, not user-scoped."""

import shutil
import tempfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import Company

User = get_user_model()
MEDIA = tempfile.mkdtemp()


def image_file(name="logo.png", size=(800, 200)):
    """A wide wordmark — the shape a company logo usually is."""
    buffer = BytesIO()
    Image.new("RGBA", size, (208, 74, 2, 255)).save(buffer, format="PNG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/png")


@override_settings(MEDIA_ROOT=MEDIA)
class CompanyLogoApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_upload_keeps_the_aspect_ratio(self):
        response = self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": image_file()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["logo"].startswith("http"))

        self.company.refresh_from_db()
        with Image.open(self.company.logo.path) as saved:
            # Contained, not cropped: a 4:1 wordmark stays 4:1.
            self.assertEqual(saved.width, 256)
            self.assertEqual(saved.height, 64)
            self.assertEqual(saved.mode, "RGBA")

    def test_logo_appears_in_the_company_list(self):
        self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": image_file()},
            format="multipart",
        )
        response = self.client.get("/api/companies/")
        row = next(r for r in response.data if r["id"] == self.company.id)
        self.assertIsNotNone(row["logo"])

    def test_logo_is_null_until_uploaded(self):
        response = self.client.get("/api/companies/")
        self.assertIsNone(response.data[0]["logo"])

    def test_delete_clears_it(self):
        self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": image_file()},
            format="multipart",
        )
        response = self.client.delete(f"/api/companies/{self.company.id}/logo/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["logo"])

    def test_non_image_is_rejected(self):
        bogus = SimpleUploadedFile("brand.txt", b"not a logo", "text/plain")
        response = self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": bogus},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("logo", response.data)

    def test_logo_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": image_file()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 401)
