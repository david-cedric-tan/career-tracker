"""Resume attachments — PDF / Word / Pages (FR-RES-08)."""

import os
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import Resume

User = get_user_model()
MEDIA = tempfile.mkdtemp()

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"
ZIP = b"PK\x03\x04" + b"\x00" * 60  # what .docx and .pages actually are


@override_settings(MEDIA_ROOT=MEDIA)
class ResumeFileApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.resume = Resume.objects.create(user=self.user, label="ey-vac-2026")

    def upload(self, name, content, resume=None):
        return self.client.post(
            f"/api/resumes/{(resume or self.resume).id}/file/",
            {"file": SimpleUploadedFile(name, content)},
            format="multipart",
        )

    def test_pdf_upload_keeps_the_original_name(self):
        response = self.upload("Dave Tan — EY Vacationer.pdf", PDF)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["file_name"], "Dave Tan — EY Vacationer.pdf")
        self.assertEqual(response.data["file_kind"], "PDF")
        self.assertTrue(response.data["file"].startswith("http"))
        self.assertGreater(response.data["file_size"], 0)

        # …while the stored name is suffixed, so a replacement can't be cached.
        self.resume.refresh_from_db()
        self.assertNotIn("Dave Tan", self.resume.file.name)
        self.assertTrue(self.resume.file.name.endswith(".pdf"))

    def test_docx_and_pages_are_accepted(self):
        self.assertEqual(self.upload("cv.docx", ZIP).status_code, 200)
        self.assertEqual(self.upload("cv.pages", ZIP).data["file_kind"], "Pages")

    def test_file_is_null_until_uploaded(self):
        response = self.client.get(f"/api/resumes/{self.resume.id}/")
        self.assertIsNone(response.data["file"])
        self.assertIsNone(response.data["file_kind"])

    def test_unsupported_type_is_rejected(self):
        response = self.upload("resume.exe", b"MZ\x90\x00")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_a_pdf_extension_on_a_non_pdf_is_rejected(self):
        response = self.upload("sneaky.pdf", b"<html>not a pdf</html>")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    @override_settings(MEDIA_ROOT=MEDIA, MAX_UPLOAD_DOCUMENT_BYTES=32)
    def test_oversized_file_is_rejected(self):
        response = self.upload("big.pdf", PDF + b"0" * 4096)
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_replacing_removes_the_previous_document(self):
        self.upload("first.pdf", PDF)
        self.resume.refresh_from_db()
        first = self.resume.file.path

        self.upload("second.pdf", PDF)
        self.resume.refresh_from_db()
        second = self.resume.file.path

        self.assertNotEqual(first, second)
        self.assertFalse(os.path.exists(first))
        self.assertTrue(os.path.exists(second))

    def test_delete_clears_it(self):
        self.upload("cv.pdf", PDF)
        response = self.client.delete(f"/api/resumes/{self.resume.id}/file/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["file"])
        self.assertEqual(response.data["file_name"], "")

    def test_cannot_attach_to_another_users_resume(self):
        theirs = Resume.objects.create(user=self.other, label="theirs")
        self.assertEqual(self.upload("cv.pdf", PDF, resume=theirs).status_code, 404)

    def test_editing_a_resume_keeps_its_attachment(self):
        self.upload("cv.pdf", PDF)
        response = self.client.patch(
            f"/api/resumes/{self.resume.id}/", {"notes": "Tweaked"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["file"])
