"""Contact photo upload."""

import shutil
import tempfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import Person

User = get_user_model()
MEDIA = tempfile.mkdtemp()


def image_file(name="face.jpg", size=(1200, 800)):
    buffer = BytesIO()
    Image.new("RGB", size, (120, 160, 200)).save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class PersonPhotoApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.person = Person.objects.create(user=self.user, full_name="Sarah Chen")

    def test_upload_sets_a_square_photo(self):
        response = self.client.post(
            f"/api/people/{self.person.id}/photo/",
            {"photo": image_file()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["photo"].startswith("http"))

        self.person.refresh_from_db()
        with Image.open(self.person.photo.path) as saved:
            self.assertEqual(saved.width, saved.height)

    def test_photo_appears_in_the_list(self):
        self.client.post(
            f"/api/people/{self.person.id}/photo/",
            {"photo": image_file()},
            format="multipart",
        )
        response = self.client.get("/api/people/")
        self.assertIsNotNone(response.data[0]["photo"])

    def test_delete_clears_it(self):
        self.client.post(
            f"/api/people/{self.person.id}/photo/",
            {"photo": image_file()},
            format="multipart",
        )
        response = self.client.delete(f"/api/people/{self.person.id}/photo/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["photo"])

    def test_cannot_photograph_someone_elses_contact(self):
        theirs = Person.objects.create(user=self.other, full_name="Not Mine")
        response = self.client.post(
            f"/api/people/{theirs.id}/photo/",
            {"photo": image_file()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)

    def test_non_image_is_rejected(self):
        bogus = SimpleUploadedFile("notes.txt", b"hello", "text/plain")
        response = self.client.post(
            f"/api/people/{self.person.id}/photo/",
            {"photo": bogus},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("photo", response.data)

    def test_editing_a_person_keeps_their_photo(self):
        self.client.post(
            f"/api/people/{self.person.id}/photo/",
            {"photo": image_file()},
            format="multipart",
        )
        response = self.client.patch(
            f"/api/people/{self.person.id}/",
            {"title": "Senior Consultant"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["photo"])


@override_settings(MEDIA_ROOT=MEDIA)
class PersonCompanyDetailsTests(APITestCase):
    """The bubble view groups people by company, so each person carries their
    companies' names and logos rather than only the ids."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        from applications.models import Company

        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.person = Person.objects.create(user=self.user, full_name="Sarah Chen")
        self.person.companies.set([self.company])

    def test_list_carries_company_details(self):
        response = self.client.get("/api/people/")
        details = response.data[0]["company_details"]
        self.assertEqual(len(details), 1)
        self.assertEqual(details[0]["name"], "EY")
        self.assertIsNone(details[0]["logo"])

    def test_company_logo_flows_through_to_people(self):
        self.client.post(
            f"/api/companies/{self.company.id}/logo/",
            {"logo": image_file(name="logo.png")},
            format="multipart",
        )
        response = self.client.get("/api/people/")
        details = response.data[0]["company_details"]
        self.assertTrue(details[0]["logo"].startswith("http"))
