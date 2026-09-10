from django.urls import path

from .views import (
    activity,
    attention,
    calendar_events,
    calendar_ics,
    companies,
    mentions,
    regions,
    summary,
    timeseries,
)

urlpatterns = [
    path("summary/", summary, name="dashboard-summary"),
    path("timeseries/", timeseries, name="dashboard-timeseries"),
    path("activity/", activity, name="dashboard-activity"),
    path("attention/", attention, name="dashboard-attention"),
    path("companies/", companies, name="dashboard-companies"),
    path("regions/", regions, name="dashboard-regions"),
    path("mentions/", mentions, name="dashboard-mentions"),
    path("calendar/", calendar_events, name="dashboard-calendar"),
    path("calendar.ics", calendar_ics, name="dashboard-calendar-ics"),
]
