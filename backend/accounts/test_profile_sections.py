"""Education / Certification / ExtraCurricular / Links / Addresses (FR-PROF-10..13)."""

import os
import shutil
import tempfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from .models import Certification, Education, ExtraCurricular, ProfileAttachment

User = get_user_model()
MEDIA = tempfile.mkdtemp()

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer\n%%EOF"


def image_file(name="cert.jpg"):
    buffer = BytesIO()
    Image.new("RGB", (600, 400), (10, 20, 30)).save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=MEDIA)
class SectionTestBase(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)


class EducationApiTests(SectionTestBase):
    def create(self, **overrides):
        payload = {
            "school": "UNSW",
            "degree": "BCom",
            "started_on": "2023-02-01",
            **overrides,
        }
        return self.client.post("/api/auth/education/", payload, format="json")

    def test_create_and_list(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["is_current"])
        self.assertEqual(len(self.client.get("/api/auth/education/").data), 1)

    def test_end_before_start_is_rejected(self):
        response = self.create(ended_on="2022-01-01")
        self.assertEqual(response.status_code, 400)
        self.assertIn("ended_on", response.data)

    def test_scoped_to_owner(self):
        Education.objects.create(user=self.other, school="Theirs", started_on="2020-01-01")
        self.create()
        rows = self.client.get("/api/auth/education/").data
        self.assertEqual([r["school"] for r in rows], ["UNSW"])

    def test_attachment_upload_and_removal(self):
        education = self.create().data
        response = self.client.post(
            f"/api/auth/education/{education['id']}/attachments/",
            {"file": image_file(), "caption": "Transcript"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data["attachments"]), 1)
        self.assertEqual(response.data["attachments"][0]["kind"], "image")
        self.assertEqual(response.data["attachments"][0]["caption"], "Transcript")

        attachment_id = response.data["attachments"][0]["id"]
        path = ProfileAttachment.objects.get(pk=attachment_id).file.path

        removed = self.client.delete(
            f"/api/auth/education/{education['id']}/attachments/{attachment_id}/"
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.data["attachments"], [])
        self.assertFalse(os.path.exists(path))

    def test_document_attachment_is_accepted(self):
        education = self.create().data
        response = self.client.post(
            f"/api/auth/education/{education['id']}/attachments/",
            {"file": SimpleUploadedFile("transcript.pdf", PDF)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["attachments"][0]["kind"], "document")
        self.assertEqual(response.data["attachments"][0]["original_name"], "transcript.pdf")

    def test_unsupported_attachment_is_rejected(self):
        education = self.create().data
        response = self.client.post(
            f"/api/auth/education/{education['id']}/attachments/",
            {"file": SimpleUploadedFile("virus.exe", b"MZ\x90\x00")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_attach_to_another_users_education(self):
        theirs = Education.objects.create(
            user=self.other, school="Theirs", started_on="2020-01-01"
        )
        response = self.client.post(
            f"/api/auth/education/{theirs.id}/attachments/",
            {"file": image_file()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 404)

    def test_deleting_education_removes_attachment_files(self):
        education = self.create().data
        self.client.post(
            f"/api/auth/education/{education['id']}/attachments/",
            {"file": image_file()},
            format="multipart",
        )
        path = ProfileAttachment.objects.get().file.path

        self.client.delete(f"/api/auth/education/{education['id']}/")
        self.assertFalse(os.path.exists(path))


class CertificationApiTests(SectionTestBase):
    def test_create_and_expiry(self):
        response = self.client.post(
            "/api/auth/certifications/",
            {
                "name": "AWS Cloud Practitioner",
                "issuer": "Amazon",
                "issued_on": "2020-01-01",
                "expires_on": "2020-06-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["is_expired"])

    def test_expires_before_issued_is_rejected(self):
        response = self.client.post(
            "/api/auth/certifications/",
            {"name": "X", "issued_on": "2024-01-01", "expires_on": "2023-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("expires_on", response.data)


class ExtraCurricularApiTests(SectionTestBase):
    def test_create_and_scoping(self):
        response = self.client.post(
            "/api/auth/extracurriculars/",
            {"organization": "Debate Society", "role": "President", "started_on": "2022-01-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

        ExtraCurricular.objects.create(
            user=self.other, organization="Theirs", started_on="2020-01-01"
        )
        rows = self.client.get("/api/auth/extracurriculars/").data
        self.assertEqual([r["organization"] for r in rows], ["Debate Society"])


class ProfileLinkApiTests(SectionTestBase):
    def test_create_link(self):
        response = self.client.post(
            "/api/auth/links/",
            {"label": "Portfolio", "url": "https://dave.dev", "category": "portfolio"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_blank_label_is_rejected(self):
        response = self.client.post(
            "/api/auth/links/", {"label": "  ", "url": "https://dave.dev"}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class ProfileAddressApiTests(SectionTestBase):
    def test_create_address(self):
        response = self.client.post(
            "/api/auth/addresses/",
            {"label": "Home", "address": "1 Example St, Sydney"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_scoped_to_owner(self):
        from .models import ProfileAddress

        ProfileAddress.objects.create(user=self.other, label="Theirs", address="Nowhere")
        self.client.post(
            "/api/auth/addresses/", {"label": "Home", "address": "Somewhere"}, format="json"
        )
        rows = self.client.get("/api/auth/addresses/").data
        self.assertEqual([r["label"] for r in rows], ["Home"])
