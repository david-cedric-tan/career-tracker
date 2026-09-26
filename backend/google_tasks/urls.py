from django.urls import path

from .views import (
    GoogleTasksCompleteView,
    GoogleTasksDisconnectView,
    GoogleTasksResyncView,
    GoogleTasksStartView,
    GoogleTasksStatusView,
)

urlpatterns = [
    path("", GoogleTasksStatusView.as_view(), name="google-tasks-status"),
    path("start/", GoogleTasksStartView.as_view(), name="google-tasks-start"),
    path("complete/", GoogleTasksCompleteView.as_view(), name="google-tasks-complete"),
    path("resync/", GoogleTasksResyncView.as_view(), name="google-tasks-resync"),
    path("disconnect/", GoogleTasksDisconnectView.as_view(), name="google-tasks-disconnect"),
]
