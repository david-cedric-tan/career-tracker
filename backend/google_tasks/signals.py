"""Queue a Google sync whenever a todo is saved or deleted.

Signals rather than calls in the todo views, because todos are written from
more places than the API — restores, the AI import, sample data, a cascade
when an application is deleted — and each of those should reach Google too.
"""

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from todos.models import Todo

from . import sync


@receiver(post_save, sender=Todo, dispatch_uid="google_tasks_todo_saved")
def todo_saved(sender, instance, raw=False, **kwargs):
    if raw or sync.connection_for(instance.user_id) is None:
        return
    # After commit: the worker reads the todo on its own connection, and a
    # rolled-back save must not reach Google at all.
    todo_id = instance.pk
    transaction.on_commit(lambda: sync.enqueue(("push", todo_id)))


@receiver(post_delete, sender=Todo, dispatch_uid="google_tasks_todo_deleted")
def todo_deleted(sender, instance, **kwargs):
    if not instance.google_task_id or sync.connection_for(instance.user_id) is None:
        return
    job = ("delete", instance.user_id, instance.google_task_id)
    transaction.on_commit(lambda: sync.enqueue(job))
