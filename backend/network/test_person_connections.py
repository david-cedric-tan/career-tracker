from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from network.models import Person

U = get_user_model()


class PersonConnectionTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.other_user = U.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.daniel = Person.objects.create(user=self.user, full_name="Daniel Johnson")
        self.andrew = Person.objects.create(
            user=self.user, full_name="Andrew Murrie", title="Chief Executive Officer"
        )

    def test_connecting_is_visible_from_both_sides(self):
        r = self.client.patch(
            f"/api/people/{self.andrew.id}/",
            {"connections": [self.daniel.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(
            [c["full_name"] for c in r.data["connection_details"]], ["Daniel Johnson"]
        )

        # Symmetrical: never recorded on Daniel, but it shows there anyway.
        back = self.client.get(f"/api/people/{self.daniel.id}/")
        self.assertEqual(
            [c["full_name"] for c in back.data["connection_details"]], ["Andrew Murrie"]
        )

    def test_connection_detail_carries_role_and_photo_slot(self):
        self.client.patch(
            f"/api/people/{self.daniel.id}/",
            {"connections": [self.andrew.id]},
            format="json",
        )
        row = self.client.get(f"/api/people/{self.daniel.id}/").data["connection_details"][0]
        self.assertEqual(row["title"], "Chief Executive Officer")
        self.assertIsNone(row["photo"])
        self.assertEqual(row["id"], self.andrew.id)

    def test_cannot_link_someone_elses_contact(self):
        theirs = Person.objects.create(user=self.other_user, full_name="Stranger")
        r = self.client.patch(
            f"/api/people/{self.andrew.id}/",
            {"connections": [theirs.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_cannot_connect_a_person_to_themselves(self):
        r = self.client.patch(
            f"/api/people/{self.andrew.id}/",
            {"connections": [self.andrew.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_removing_a_connection_clears_it_both_ways(self):
        self.client.patch(
            f"/api/people/{self.andrew.id}/", {"connections": [self.daniel.id]}, format="json"
        )
        self.client.patch(
            f"/api/people/{self.andrew.id}/", {"connections": []}, format="json"
        )
        back = self.client.get(f"/api/people/{self.daniel.id}/")
        self.assertEqual(back.data["connection_details"], [])
