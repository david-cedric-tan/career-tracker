from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from applications.models import Resume

U = get_user_model()


class ResumeFileNameScopeTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.other = U.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def resume(self, label, user=None):
        return Resume.objects.create(user=user or self.user, label=label)

    def upload(self, resume, name="Resume_2026.pdf"):
        return self.client.post(
            f"/api/resumes/{resume.id}/file/",
            {"file": SimpleUploadedFile(name, b"%PDF-1.4 fake", content_type="application/pdf")},
            format="multipart",
        )

    def test_same_file_name_twice_for_one_user_is_rejected(self):
        first, second = self.resume("General"), self.resume("Tailored")
        self.assertEqual(self.upload(first).status_code, 200)

        r = self.upload(second)
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn("file", r.data)

    def test_two_users_may_share_a_file_name(self):
        mine = self.resume("General")
        self.assertEqual(self.upload(mine).status_code, 200)

        theirs = self.resume("Their general", user=self.other)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.upload(theirs).status_code, 200)

    def test_replacing_a_resumes_own_file_with_the_same_name_still_works(self):
        mine = self.resume("General")
        self.assertEqual(self.upload(mine).status_code, 200)
        self.assertEqual(self.upload(mine).status_code, 200)

    def test_several_resumes_may_have_no_file_at_all(self):
        """The constraint is partial, so blank names don't collide."""
        self.resume("A")
        self.resume("B")
        self.assertEqual(Resume.objects.filter(user=self.user, file_name="").count(), 2)

    def test_name_frees_up_after_the_file_is_removed(self):
        first, second = self.resume("General"), self.resume("Tailored")
        self.upload(first)
        self.client.delete(f"/api/resumes/{first.id}/file/")
        self.assertEqual(self.upload(second).status_code, 200)
