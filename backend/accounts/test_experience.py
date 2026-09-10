"""Work experience and its photo gallery (FR-EXP-*)."""

import os
import shutil
import tempfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from applications.models import Company

from .models import Experience, ExperiencePhoto

User = get_user_model()
MEDIA = tempfile.mkdtemp()


def image_file(name="team.jpg", size=(2400, 1600)):
    buffer = BytesIO()
    Image.new("RGB", size, (60, 110, 190)).save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class ExperienceApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def create(self, **overrides):
        payload = {
            "company": self.company.id,
            "title": "Vacationer",
            "started_on": "2026-01-05",
            **overrides,
        }
        return self.client.post("/api/auth/experiences/", payload, format="json")

    def test_create_and_list(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["company_name"], "EY")
        # No end date means the role is current.
        self.assertTrue(response.data["is_current"])

        listed = self.client.get("/api/auth/experiences/")
        self.assertEqual(len(listed.data), 1)

    def test_end_date_cannot_precede_the_start(self):
        response = self.create(ended_on="2025-01-01")
        self.assertEqual(response.status_code, 400)
        self.assertIn("ended_on", response.data)

    def test_experiences_are_scoped_to_the_owner(self):
        Experience.objects.create(
            user=self.other,
            company=self.company,
            title="Theirs",
            started_on="2026-01-01",
        )
        self.create()
        response = self.client.get("/api/auth/experiences/")
        self.assertEqual([row["title"] for row in response.data], ["Vacationer"])

    def test_gallery_upload_keeps_the_whole_frame(self):
        experience = self.create().data
        response = self.client.post(
            f"/api/auth/experiences/{experience['id']}/photos/",
            {"image": image_file(), "caption": "Grad induction"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["photos"]), 1)
        self.assertEqual(response.data["photos"][0]["caption"], "Grad induction")
        self.assertTrue(response.data["photos"][0]["image"].startswith("http"))

        photo = ExperiencePhoto.objects.get()
        with Image.open(photo.image.path) as saved:
            # Contained, not cropped: a 3:2 photo stays 3:2.
            self.assertEqual(saved.width, 1024)
            self.assertEqual(saved.height, 683)

    def test_gallery_accepts_several_photos(self):
        experience = self.create().data
        for index in range(3):
            self.client.post(
                f"/api/auth/experiences/{experience['id']}/photos/",
                {"image": image_file(name=f"p{index}.jpg")},
                format="multipart",
            )
        response = self.client.get(f"/api/auth/experiences/{experience['id']}/")
        self.assertEqual(len(response.data["photos"]), 3)

    def test_non_image_is_rejected(self):
        experience = self.create().data
        bogus = SimpleUploadedFile("notes.txt", b"nope", "text/plain")
        response = self.client.post(
            f"/api/auth/experiences/{experience['id']}/photos/",
            {"image": bogus},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.data)

    def test_removing_a_photo_deletes_its_file(self):
        experience = self.create().data
        self.client.post(
            f"/api/auth/experiences/{experience['id']}/photos/",
            {"image": image_file()},
            format="multipart",
        )
        path = ExperiencePhoto.objects.get().image.path
        photo_id = ExperiencePhoto.objects.get().id

        response = self.client.delete(
            f"/api/auth/experiences/{experience['id']}/photos/{photo_id}/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["photos"], [])
        self.assertFalse(os.path.exists(path))

    def test_cannot_delete_a_photo_from_another_gallery(self):
        mine = self.create().data
        theirs = Experience.objects.create(
            user=self.other,
            company=self.company,
            title="Theirs",
            started_on="2026-01-01",
        )
        photo = ExperiencePhoto.objects.create(
            experience=theirs, image=image_file(name="theirs.jpg")
        )
        response = self.client.delete(
            f"/api/auth/experiences/{mine['id']}/photos/{photo.id}/"
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(ExperiencePhoto.objects.filter(pk=photo.id).exists())

    def test_deleting_an_experience_removes_its_gallery_files(self):
        experience = self.create().data
        self.client.post(
            f"/api/auth/experiences/{experience['id']}/photos/",
            {"image": image_file()},
            format="multipart",
        )
        path = ExperiencePhoto.objects.get().image.path

        self.client.delete(f"/api/auth/experiences/{experience['id']}/")
        # FR-EXP-06 — the cascade cleans up storage, not just rows.
        self.assertFalse(os.path.exists(path))
