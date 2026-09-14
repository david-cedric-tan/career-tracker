"""Give the app's owner the developer flag.

Hard-coding a username in a migration is normally a smell, but this is a
two-person app with a single maintainer, and the alternative — shipping with
nobody able to read the suggestion box until someone remembers to run a
command — makes the feature silently useless on a fresh database.

`DEVELOPER_USERNAME` in the environment overrides it, and the account does not
have to exist yet — `Profile.for_user` applies the same rule to an account
registered after this migration runs.
"""

from django.conf import settings
from django.db import migrations


def grant(apps, schema_editor):
    User = apps.get_model("auth", "User")
    Profile = apps.get_model("accounts", "Profile")
    username = getattr(settings, "DEVELOPER_USERNAME", "")
    if not username:
        return

    for user in User.objects.filter(username__iexact=username):
        profile, _ = Profile.objects.get_or_create(user=user)
        if not profile.is_developer:
            profile.is_developer = True
            profile.save(update_fields=["is_developer"])


def revoke(apps, schema_editor):
    Profile = apps.get_model("accounts", "Profile")
    username = getattr(settings, "DEVELOPER_USERNAME", "")
    if username:
        Profile.objects.filter(user__username__iexact=username).update(
            is_developer=False
        )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0011_refinement_resolution_and_developer_flag"),
    ]

    operations = [migrations.RunPython(grant, revoke)]
