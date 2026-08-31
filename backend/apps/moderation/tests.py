import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.moderation.models import Report

SECRET = "test-jwt-secret"


def make_token(sub=None, email="trav@example.com"):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": sub or str(uuid.uuid4()),
            "email": email,
            "aud": SUPABASE_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def settings_secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


@pytest.fixture
def client(settings_secret):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token()}")
    return c


@pytest.mark.django_db
def test_file_a_report(client):
    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    other.get("/api/profile/me/")  # force the target's Profile to exist
    target = Profile.objects.get(user__email="other@example.com")

    resp = client.post(
        "/api/reports/",
        {
            "reported_user_id": str(target.supabase_user_id),
            "reason": "harassment",
            "details": "Kept messaging after I said no.",
        },
        format="json",
    )
    assert resp.status_code == 201
    report = Report.objects.get()
    assert report.reported_user_id == target.user_id
    assert report.status == "open"


@pytest.mark.django_db
def test_cannot_report_yourself(client):
    me = client.get("/api/profile/me/").data
    resp = client.post(
        "/api/reports/",
        {"reported_user_id": me["supabase_user_id"], "reason": "spam"},
        format="json",
    )
    assert resp.status_code == 400
    assert not Report.objects.exists()


@pytest.mark.django_db
def test_reporting_requires_auth():
    resp = APIClient().post(
        "/api/reports/",
        {"reported_user_id": str(uuid.uuid4()), "reason": "spam"},
        format="json",
    )
    assert resp.status_code == 401
