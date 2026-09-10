from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from applications.models import Company
from network.models import Person, PersonCompany

U = get_user_model()


class PersonCompanyApiTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.deloitte = Company.objects.create(name="Deloitte")
        self.ey = Company.objects.create(name="EY")

    def create_person(self, **extra):
        payload = {"full_name": "Sam Rivera", **extra}
        r = self.client.post("/api/people/", payload, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def test_plain_company_ids_still_work(self):
        data = self.create_person(companies=[self.deloitte.id])
        self.assertEqual([c["name"] for c in data["company_details"]], ["Deloitte"])
        self.assertFalse(data["company_details"][0]["is_past"])

    def test_memberships_carry_dates_and_past_flag(self):
        data = self.create_person(
            company_memberships=[
                {
                    "company": self.deloitte.id,
                    "title": "Analyst",
                    "started_on": "2022-01-01",
                    "ended_on": "2024-06-30",
                },
                {"company": self.ey.id, "started_on": "2024-07-01"},
            ]
        )
        by_name = {c["name"]: c for c in data["company_details"]}
        self.assertTrue(by_name["Deloitte"]["is_past"])
        self.assertEqual(by_name["Deloitte"]["title"], "Analyst")
        self.assertFalse(by_name["EY"]["is_past"])

    def test_past_is_per_edge_not_per_person(self):
        """The whole point: gone from one company, current at another."""
        data = self.create_person(
            company_memberships=[
                {"company": self.deloitte.id, "is_current": False},
                {"company": self.ey.id, "is_current": True},
            ]
        )
        by_name = {c["name"]: c for c in data["company_details"]}
        self.assertTrue(by_name["Deloitte"]["is_past"])
        self.assertFalse(by_name["EY"]["is_past"])

    def test_editing_memberships_replaces_them(self):
        data = self.create_person(
            company_memberships=[{"company": self.deloitte.id}, {"company": self.ey.id}]
        )
        r = self.client.patch(
            f"/api/people/{data['id']}/",
            {"company_memberships": [{"company": self.ey.id, "is_current": True}]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([c["name"] for c in r.data["company_details"]], ["EY"])

    def test_editing_by_plain_ids_keeps_existing_dates(self):
        data = self.create_person(
            company_memberships=[
                {"company": self.deloitte.id, "ended_on": "2024-06-30"},
            ]
        )
        self.client.patch(
            f"/api/people/{data['id']}/",
            {"companies": [self.deloitte.id, self.ey.id]},
            format="json",
        )
        link = PersonCompany.objects.get(person_id=data["id"], company=self.deloitte)
        self.assertEqual(link.ended_on, date(2024, 6, 30))

    def test_contradictory_membership_is_rejected(self):
        r = self.client.post(
            "/api/people/",
            {
                "full_name": "Sam",
                "company_memberships": [
                    {
                        "company": self.ey.id,
                        "is_current": True,
                        "ended_on": (date.today() - timedelta(days=1)).isoformat(),
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_end_before_start_is_rejected(self):
        r = self.client.post(
            "/api/people/",
            {
                "full_name": "Sam",
                "company_memberships": [
                    {"company": self.ey.id, "started_on": "2024-01-01", "ended_on": "2023-01-01"}
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
