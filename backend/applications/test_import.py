"""The job-listing importer: the consuming half of the copy-paste AI prompt.

An AI turns a pasted job ad into JSON shaped to these fields; this is what
reads that JSON back in. The point of these tests is mostly the forgiving
behaviour — one bad field, or one bad row in a batch, must not sink the rest.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Company, JobListing, Role

User = get_user_model()


class JobListingImportTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_imports_a_new_listing_creating_company_and_role(self):
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {
                "listings": [
                    {
                        "company": "CommBank",
                        "role": "Business Banking Relationship Management Intern",
                        "role_type": "vacationer",
                        "description": "About the role...",
                        "skills": ["Accounting", "Finance", "Excel"],
                        "closing_at": "2026-11-30",
                        "job_url": "https://www.commbank.com.au/earlycareers",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        result = response.data["results"][0]
        self.assertTrue(result["ok"])
        self.assertTrue(result["created"])
        self.assertTrue(Company.objects.filter(name="CommBank").exists())
        self.assertTrue(
            Role.objects.filter(name="Business Banking Relationship Management Intern").exists()
        )
        listing = JobListing.objects.get(id=result["id"])
        self.assertEqual(listing.skills, "Accounting, Finance, Excel")
        self.assertEqual(listing.role_type, "vacationer")
        self.assertEqual(str(listing.closing_at), "2026-11-30")

    def test_reuses_an_existing_company_case_insensitively(self):
        Company.objects.create(name="CommBank")
        self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "commbank", "role": "Graduate Analyst"}]},
            format="json",
        )
        self.assertEqual(Company.objects.filter(name__iexact="commbank").count(), 1)

    def test_unknown_role_type_is_dropped_with_a_warning_not_an_error(self):
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "EY", "role": "Graduate", "role_type": "not_a_real_type"}]},
            format="json",
        )
        result = response.data["results"][0]
        self.assertTrue(result["ok"])
        self.assertTrue(any("role_type" in w for w in result["warnings"]))
        listing = JobListing.objects.get(id=result["id"])
        self.assertEqual(listing.role_type, "")

    def test_location_is_skipped_with_a_warning(self):
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "EY", "role": "Graduate", "location": "Sydney"}]},
            format="json",
        )
        result = response.data["results"][0]
        self.assertTrue(any("Sydney" in w for w in result["warnings"]))

    def test_missing_company_or_role_fails_that_row_only(self):
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {
                "listings": [
                    {"company": "", "role": "Graduate"},
                    {"company": "EY", "role": "Graduate"},
                ]
            },
            format="json",
        )
        results = response.data["results"]
        self.assertFalse(results[0]["ok"])
        self.assertTrue(results[1]["ok"])

    def test_reimporting_the_same_listing_updates_rather_than_duplicates(self):
        self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "EY", "role": "Graduate", "skills": "Excel"}]},
            format="json",
        )
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "EY", "role": "Graduate", "skills": "Excel, SQL"}]},
            format="json",
        )
        result = response.data["results"][0]
        self.assertFalse(result["created"])
        self.assertEqual(JobListing.objects.filter(company__name="EY", role__name="Graduate").count(), 1)
        self.assertEqual(JobListing.objects.get(id=result["id"]).skills, "Excel, SQL")

    def test_empty_listings_array_is_rejected(self):
        response = self.client.post(
            "/api/job-listings/import_listings/", {"listings": []}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "EY", "role": "Graduate"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
