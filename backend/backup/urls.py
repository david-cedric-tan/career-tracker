from django.urls import path

from .views import export_json, export_summary, export_xlsx, export_zip, import_archive

urlpatterns = [
    path("summary/", export_summary, name="backup-summary"),
    path("export.json", export_json, name="backup-export-json"),
    path("export.xlsx", export_xlsx, name="backup-export-xlsx"),
    path("export.zip", export_zip, name="backup-export-zip"),
    path("import/", import_archive, name="backup-import"),
]
