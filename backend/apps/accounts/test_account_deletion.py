import uuid
from unittest import mock

import pytest
import requests
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.accounts.tests import SECRET, auth, make_token
from apps.trips.models import Trip, TripCollaborator

User = get_user_model()
URL = "/api/profile/delete-account/"
SUPABASE_URL = "https://example.supabase.co"


def fake_response(status_code=200, payload=None):
    response = mock.Mock(status_code=status_code, ok=200 <= status_code < 300)
    response.json.return_value = payload if payload is not None else []
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(str(status_code))
    return response


@pytest.fixture
def configured(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    settings.SUPABASE_URL = SUPABASE_URL
    settings.SUPABASE_SERVICE_ROLE_KEY = "service-role-key"
    return settings


@pytest.fixture
def traveller(configured):
    """A signed-in traveller: (client, supabase user id, Django user)."""
    sub = str(uuid.uuid4())
    client = auth(APIClient(), make_token(sub=sub))
    assert client.get("/api/profile/me/").status_code == 200
    return client, sub, User.objects.get(username=sub)


@pytest.fixture
def supabase():
    """Mock Supabase: auth delete succeeds; each storage folder holds one file."""
    with (
        mock.patch("apps.accounts.deletion.requests.delete") as delete,
        mock.patch("apps.accounts.deletion.requests.post") as post,
    ):
        delete.return_value = fake_response(200)
        post.return_value = fake_response(200, [{"id": "f1", "name": "1700000000.jpg"}])
        yield mock.Mock(delete=delete, post=post)


@pytest.mark.django_db
def test_deletes_the_account_and_everything_it_owns(traveller, supabase):
    client, sub, user = traveller
    other = User.objects.create_user(username="other")
    own_trip = Trip.objects.create(owner=user, title="Mine")
    shared_trip = Trip.objects.create(owner=other, title="Theirs")
    TripCollaborator.objects.create(trip=shared_trip, user=user)

    resp = client.post(URL, {"confirm": "DELETE"}, format="json")

    assert resp.status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()
    assert not Profile.objects.filter(supabase_user_id=sub).exists()
    assert not Trip.objects.filter(pk=own_trip.pk).exists()
    # Someone else's trip stays; only the membership goes.
    assert Trip.objects.filter(pk=shared_trip.pk).exists()
    assert not TripCollaborator.objects.filter(trip=shared_trip).exists()

    # The Supabase Auth user is removed…
    auth_call = supabase.delete.call_args_list[0]
    assert auth_call.args[0] == f"{SUPABASE_URL}/auth/v1/admin/users/{sub}"
    # …and so are their photo and their own trip's cover, but not other trips'.
    listed = {(c.args[0].rsplit("/", 1)[1], c.kwargs["json"]["prefix"]) for c in supabase.post.call_args_list}
    assert listed == {("avatars", sub), ("trip-covers", str(own_trip.pk))}
    removed = [c.kwargs["json"]["prefixes"] for c in supabase.delete.call_args_list[1:]]
    assert [f"{sub}/1700000000.jpg"] in removed


@pytest.mark.django_db
def test_requires_typed_confirmation(traveller, supabase):
    client, _, user = traveller
    for body in ({}, {"confirm": "delete"}, {"confirm": "yes"}):
        resp = client.post(URL, body, format="json")
        assert resp.status_code == 400
    assert User.objects.filter(pk=user.pk).exists()
    supabase.delete.assert_not_called()


@pytest.mark.django_db
def test_nothing_is_deleted_if_supabase_refuses(traveller, supabase):
    client, _, user = traveller
    Trip.objects.create(owner=user, title="Mine")
    supabase.delete.return_value = fake_response(500)

    resp = client.post(URL, {"confirm": "DELETE"}, format="json")

    assert resp.status_code == 503
    assert User.objects.filter(pk=user.pk).exists()
    assert Trip.objects.filter(owner=user).exists()
    supabase.post.assert_not_called()


@pytest.mark.django_db
def test_nothing_is_deleted_if_supabase_is_unreachable(traveller, supabase):
    client, _, user = traveller
    supabase.delete.side_effect = requests.ConnectionError("down")

    resp = client.post(URL, {"confirm": "DELETE"}, format="json")

    assert resp.status_code == 503
    assert User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
def test_unavailable_without_the_service_role_key(traveller, supabase, settings):
    client, _, user = traveller
    settings.SUPABASE_SERVICE_ROLE_KEY = ""

    resp = client.post(URL, {"confirm": "DELETE"}, format="json")

    assert resp.status_code == 503
    assert User.objects.filter(pk=user.pk).exists()
    supabase.delete.assert_not_called()


@pytest.mark.django_db
def test_already_gone_from_supabase_still_deletes(traveller, supabase):
    client, _, user = traveller
    supabase.delete.return_value = fake_response(404)

    assert client.post(URL, {"confirm": "DELETE"}, format="json").status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
def test_a_storage_failure_does_not_undo_the_deletion(traveller, supabase):
    client, _, user = traveller
    supabase.post.side_effect = requests.ConnectionError("storage down")

    assert client.post(URL, {"confirm": "DELETE"}, format="json").status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()


@pytest.mark.django_db
def test_needs_sign_in(configured):
    assert APIClient().post(URL, {"confirm": "DELETE"}, format="json").status_code == 401
