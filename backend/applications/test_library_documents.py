from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from applications.models import Application, Company, LibraryDocument

U = get_user_model()


class LibraryDocumentTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.app = Application.objects.create(user=self.user, company=self.company)

    def test_create_general_file_with_tags(self):
        response = self.client.post(
            "/api/library-documents/",
            {
                "file": SimpleUploadedFile(
                    "notes.txt", b"hello", content_type="text/plain"
                ),
                "title": "Prep notes",
                "tags": ["prep", "oa"],
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["application"])
        self.assertEqual(response.data["tags"], ["prep", "oa"])
        self.assertTrue(LibraryDocument.objects.filter(user=self.user).exists())

    def test_create_linked_to_application(self):
        response = self.client.post(
            "/api/library-documents/",
            {
                "file": SimpleUploadedFile(
                    "cover.pdf", b"%PDF-1.4 fake", content_type="application/pdf"
                ),
                "title": "Cover",
                "application": self.app.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["application"], self.app.id)
        self.assertEqual(response.data["application_company"], "EY")

    def test_scope_filters(self):
        LibraryDocument.objects.create(
            user=self.user,
            application=self.app,
            file=SimpleUploadedFile("a.pdf", b"%PDF-1.4 a"),
            title="Linked",
            kind="document",
            original_name="a.pdf",
        )
        LibraryDocument.objects.create(
            user=self.user,
            application=None,
            file=SimpleUploadedFile("b.pdf", b"%PDF-1.4 b"),
            title="General",
            kind="document",
            original_name="b.pdf",
            tags=["misc"],
        )
        linked = self.client.get("/api/library-documents/", {"scope": "linked"})
        general = self.client.get("/api/library-documents/", {"scope": "general"})
        tagged = self.client.get("/api/library-documents/", {"tag": "misc"})
        self.assertEqual([row["title"] for row in linked.data], ["Linked"])
        self.assertEqual([row["title"] for row in general.data], ["General"])
        self.assertEqual([row["title"] for row in tagged.data], ["General"])
