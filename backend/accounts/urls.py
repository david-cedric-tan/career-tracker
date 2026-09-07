from django.urls import path

from .views import LoginView, LogoutView, AccountView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", AccountView.as_view(), name="auth-account"),
]
