"""Deleting a traveller's account for good.

This removes everything TripBuddy holds about the user:

* the Django user, which cascades to their profile, the trips they own (with
  plans, budgets and group chat), trip memberships, connections, messages,
  reviews and reports (see each model's ``on_delete``);
* the Supabase Auth user, so the email and password can't sign in again;
* their profile photos, and the covers of trips they owned, in Supabase Storage.

The database delete and the Supabase Auth delete share one transaction. If
Supabase refuses, the database rolls back and the account is left intact
rather than half-deleted. Storage cleanup runs only after both have succeeded
and is best effort: once nothing links to a file, a leftover copy is harmless.
"""

import logging

import requests
from django.conf import settings
from django.core.cache import cache
from django.db import transaction

from apps.accounts.authentication import user_cache_key

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10


class AccountDeletionError(Exception):
    """The account could not be deleted; nothing was removed."""


def deletion_available():
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)


def _base_url():
    return settings.SUPABASE_URL.rstrip("/")


def _headers():
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _delete_auth_user(supabase_user_id):
    try:
        response = requests.delete(
            f"{_base_url()}/auth/v1/admin/users/{supabase_user_id}",
            headers=_headers(),
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise AccountDeletionError("Could not reach Supabase Auth.") from exc
    if response.status_code == 404:
        return  # Already gone from Supabase: nothing left to do there.
    if not response.ok:
        logger.error(
            "Supabase refused to delete auth user %s (HTTP %s)",
            supabase_user_id,
            response.status_code,
        )
        raise AccountDeletionError("Supabase Auth refused the deletion.")


def _delete_storage_folder(bucket, folder):
    response = requests.post(
        f"{_base_url()}/storage/v1/object/list/{bucket}",
        json={"prefix": folder, "limit": 1000},
        headers=_headers(),
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    # Sub-folders come back with a null id; uploads never create any.
    paths = [f"{folder}/{item['name']}" for item in response.json() if item.get("id")]
    if paths:
        requests.delete(
            f"{_base_url()}/storage/v1/object/{bucket}",
            json={"prefixes": paths},
            headers=_headers(),
            timeout=TIMEOUT_SECONDS,
        ).raise_for_status()


def _delete_files(supabase_user_id, owned_trip_ids):
    # Upload paths: avatars/<supabase user id>/…, trip-covers/<trip id>/…
    folders = [("avatars", str(supabase_user_id))]
    folders += [("trip-covers", str(trip_id)) for trip_id in owned_trip_ids]
    for bucket, folder in folders:
        try:
            _delete_storage_folder(bucket, folder)
        except (requests.RequestException, ValueError) as exc:
            logger.warning("Could not remove %s/%s after account deletion: %s", bucket, folder, exc)


def delete_account(user, supabase_user_id):
    """Delete ``user`` everywhere. Raises ``AccountDeletionError`` if it can't."""
    if not deletion_available():
        raise AccountDeletionError("Supabase admin access is not configured.")

    owned_trip_ids = list(user.trips.values_list("id", flat=True))

    with transaction.atomic():
        user.delete()
        _delete_auth_user(supabase_user_id)

    cache.delete(user_cache_key(supabase_user_id))
    _delete_files(supabase_user_id, owned_trip_ids)
