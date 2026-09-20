"""Alternate formats of one resume: the .docx kept beside the .pdf."""

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from applications.models import Resume, ResumeFile

U = get_user_model()

PDF = b"%PDF-1.4 fake"
DOCX = b"PK\x03\x04 fake docx"


class ResumeAlternateFileTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.resume = Resume.objects.create(user=self.user, label="General")

    def primary(self, name="Resume.pdf", body=PDF):
        return self.client.post(
            f"/api/resumes/{self.resume.id}/file/",
            {"file": SimpleUploadedFile(name, body)},
            format="multipart",
        )

    def alternate(self, name="Resume.docx", body=DOCX):
        return self.client.post(
            f"/api/resumes/{self.resume.id}/files/",
            {"file": SimpleUploadedFile(name, body)},
            format="multipart",
        )

    def test_docx_sits_beside_the_pdf(self):
        self.assertEqual(self.primary().status_code, 200)
        r = self.alternate()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["file_kind"], "PDF")
        self.assertEqual([f["file_kind"] for f in r.data["files"]], ["Word"])
        self.assertEqual(r.data["files"][0]["file_name"], "Resume.docx")

    def test_first_upload_becomes_the_primary_not_an_alternate(self):
        r = self.alternate()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["file_name"], "Resume.docx")
        self.assertEqual(r.data["files"], [])

    def test_same_format_as_the_primary_is_refused(self):
        self.primary()
        r = self.alternate("Other.pdf", PDF)
        self.assertEqual(r.status_code, 400)
        self.assertIn("file", r.data)

    def test_a_second_alternate_of_one_format_replaces_the_first(self):
        self.primary()
        self.alternate("v1.docx")
        r = self.alternate("v2.docx")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([f["file_name"] for f in r.data["files"]], ["v2.docx"])
        self.assertEqual(ResumeFile.objects.filter(resume=self.resume).count(), 1)

    def test_removing_an_alternate(self):
        self.primary()
        entry_id = self.alternate().data["files"][0]["id"]
        r = self.client.delete(f"/api/resumes/{self.resume.id}/files/{entry_id}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["files"], [])
        self.assertFalse(ResumeFile.objects.filter(pk=entry_id).exists())
        # The primary is untouched.
        self.assertEqual(r.data["file_name"], "Resume.pdf")

    def test_another_users_resume_is_invisible(self):
        self.primary()
        entry_id = self.alternate().data["files"][0]["id"]
        self.client.force_authenticate(U.objects.create_user("mallory", password="tracker-pass-9182"))
        self.assertEqual(self.alternate().status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/resumes/{self.resume.id}/files/{entry_id}/").status_code, 404
        )
