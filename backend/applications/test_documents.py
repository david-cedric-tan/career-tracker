from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from applications.models import Application, ApplicationDocument, Company

U = get_user_model()


class ApplicationDocumentTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.other = U.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.app = Application.objects.create(user=self.user, company=self.company)

    def upload(self, title="", name="cover.pdf", description=""):
        return self.client.post(
            f"/api/applications/{self.app.id}/documents/",
            {
                "file": SimpleUploadedFile(name, b"%PDF-1.4 fake", content_type="application/pdf"),
                "title": title,
                "description": description,
            },
            format="multipart",
        )

    def test_upload_returns_the_application_with_its_documents(self):
        r = self.upload(title="Cover letter", description="Tailored for EY")
        self.assertEqual(r.status_code, 201, r.data)
        docs = r.data["documents"]
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["title"], "Cover letter")
        self.assertEqual(docs[0]["description"], "Tailored for EY")
        self.assertTrue(docs[0]["file"].startswith("http"))

    def test_blank_title_falls_back_to_the_filename(self):
        r = self.upload(title="", name="Take Home Task.pdf")
        self.assertEqual(r.data["documents"][0]["title"], "Take Home Task")

    def test_edit_title_and_description(self):
        self.upload(title="Old")
        doc = ApplicationDocument.objects.get()
        r = self.client.patch(
            f"/api/applications/{self.app.id}/documents/{doc.id}/",
            {"title": "New", "description": "Updated"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["documents"][0]["title"], "New")

    def test_delete_removes_the_document(self):
        self.upload(title="Bye")
        doc = ApplicationDocument.objects.get()
        r = self.client.delete(f"/api/applications/{self.app.id}/documents/{doc.id}/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["documents"], [])
        self.assertFalse(ApplicationDocument.objects.exists())

    def test_cannot_touch_another_users_document(self):
        self.upload(title="Mine")
        doc = ApplicationDocument.objects.get()
        self.client.force_authenticate(self.other)
        other_app = Application.objects.create(user=self.other, company=self.company)
        r = self.client.patch(
            f"/api/applications/{other_app.id}/documents/{doc.id}/",
            {"title": "Stolen"},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        doc.refresh_from_db()
        self.assertEqual(doc.title, "Mine")

    def test_rejects_an_unsupported_file_type(self):
        r = self.client.post(
            f"/api/applications/{self.app.id}/documents/",
            {"file": SimpleUploadedFile("virus.exe", b"MZ", content_type="application/exe")},
            format="multipart",
        )
        self.assertEqual(r.status_code, 400)

    def test_documents_keep_upload_order(self):
        self.upload(title="First")
        self.upload(title="Second")
        r = self.client.get(f"/api/applications/{self.app.id}/")
        self.assertEqual([d["title"] for d in r.data["documents"]], ["First", "Second"])
