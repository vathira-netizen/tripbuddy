"""seed_pilot: idempotence, the production guard, and data shape.

Idempotence is the property worth testing hardest. A demo dataset that grows or
reshuffles on every run is worse than none — you cannot rehearse against it.
"""

import pytest
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.contrib.gis.geos import Point

from apps.accounts.models import Profile
from apps.budgets.models import BudgetItem
from apps.common.choices import AGE_BAND_ORDER, BUDGET_TIER_ORDER, INTEREST_TAGS, LANGUAGES
from apps.connections.models import Connection
from apps.destinations.models import Destination
from apps.trips.models import ItineraryItem, Trip

User = get_user_model()

SMALL = {"profiles": 8, "connections": 4, "trips": 3}


@pytest.fixture
def destinations(db):
    for i in range(5):
        Destination.objects.create(
            name=f"Place {i}",
            slug=f"place-{i}",
            point=Point(77.0 + i, 12.0 + i, srid=4326),
            avg_daily_budget=1000 + i * 500,
            budget_tier="budget",
            interest_tags=["nature"],
            region="South",
        )


@pytest.mark.django_db
def test_seeds_the_requested_number_of_records(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    assert Profile.objects.filter(user__username__startswith="pilot-").count() == 8
    assert Connection.objects.count() == 4
    assert Trip.objects.count() == 3


@pytest.mark.django_db
def test_running_twice_changes_nothing(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    first = {
        "users": User.objects.count(),
        "profiles": Profile.objects.count(),
        "connections": Connection.objects.count(),
        "trips": Trip.objects.count(),
        "itinerary": ItineraryItem.objects.count(),
        "budget": BudgetItem.objects.count(),
    }
    names = sorted(Profile.objects.values_list("display_name", flat=True))
    ids = sorted(str(u) for u in Profile.objects.values_list("supabase_user_id", flat=True))

    call_command("seed_pilot", **SMALL)

    second = {
        "users": User.objects.count(),
        "profiles": Profile.objects.count(),
        "connections": Connection.objects.count(),
        "trips": Trip.objects.count(),
        "itinerary": ItineraryItem.objects.count(),
        "budget": BudgetItem.objects.count(),
    }
    assert first == second, "re-running duplicated rows"
    # Same people, not merely the same number of people.
    assert sorted(Profile.objects.values_list("display_name", flat=True)) == names
    assert sorted(str(u) for u in Profile.objects.values_list("supabase_user_id", flat=True)) == ids


@pytest.mark.django_db
def test_generated_values_come_from_the_shared_vocabularies(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    for profile in Profile.objects.all():
        assert profile.age_band in AGE_BAND_ORDER
        assert profile.budget_style in BUDGET_TIER_ORDER
        assert set(profile.interests) <= set(INTEREST_TAGS)
        assert set(profile.languages) <= set(LANGUAGES)
        assert profile.interests, "a profile with no interests cannot be matched"
        assert profile.onboarded is True


@pytest.mark.django_db
def test_areas_are_no_more_precise_than_real_onboarding(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    for profile in Profile.objects.exclude(area_point=None):
        lat, lng = profile.area_point.y, profile.area_point.x
        # COORDINATE_PRECISION is 2dp (~1.1 km). Seeded rows must not be more
        # precise than real ones, or the demo misrepresents the privacy model.
        assert round(lat, 2) == pytest.approx(lat)
        assert round(lng, 2) == pytest.approx(lng)
        assert profile.area_label


@pytest.mark.django_db
def test_profiles_are_varied_not_identical(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    profiles = list(Profile.objects.all())
    assert len({p.area_label for p in profiles}) > 1
    assert len({p.budget_style for p in profiles}) > 1
    assert len({tuple(p.interests) for p in profiles}) > 1


@pytest.mark.django_db
def test_connections_cover_several_states(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", profiles=20, connections=12, trips=0)

    states = set(Connection.objects.values_list("status", flat=True))
    assert len(states) > 1, "a demo needs more than one connection state"
    # A blocked row must record who blocked; the unblock rule depends on it.
    for connection in Connection.objects.filter(status=Connection.Status.BLOCKED):
        assert connection.blocked_by_id is not None


@pytest.mark.django_db
def test_no_pilot_user_can_sign_in(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    for user in User.objects.filter(username__startswith="pilot-"):
        assert not user.has_usable_password()


@pytest.mark.django_db
def test_trips_have_itinerary_and_budget_rows(settings, destinations):
    settings.DEBUG = True
    call_command("seed_pilot", **SMALL)

    for trip in Trip.objects.all():
        assert trip.start_date and trip.end_date
        assert trip.end_date > trip.start_date
        assert ItineraryItem.objects.filter(trip=trip).exists()
        assert BudgetItem.objects.filter(trip=trip).exists()


@pytest.mark.django_db
def test_refuses_to_run_when_debug_is_off(settings, destinations):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_pilot", **SMALL)
    assert Profile.objects.count() == 0


@pytest.mark.django_db
def test_force_overrides_the_debug_guard(settings, destinations):
    settings.DEBUG = False
    call_command("seed_pilot", force=True, **SMALL)
    assert Profile.objects.count() == 8


@pytest.mark.django_db
def test_caps_the_dataset_at_100_records(settings, destinations):
    settings.DEBUG = True
    with pytest.raises(CommandError, match="100"):
        call_command("seed_pilot", profiles=90, connections=20, trips=10)


@pytest.mark.django_db
def test_undo_removes_everything_it_created(settings, destinations):
    settings.DEBUG = True
    real = User.objects.create_user(username="a-real-person")

    call_command("seed_pilot", **SMALL)
    assert Profile.objects.count() > 0

    call_command("seed_pilot", undo=True)

    assert User.objects.filter(username__startswith="pilot-").count() == 0
    assert Profile.objects.count() == 0
    assert Connection.objects.count() == 0
    assert Trip.objects.count() == 0
    assert ItineraryItem.objects.count() == 0
    assert BudgetItem.objects.count() == 0
    # And leaves real users alone.
    assert User.objects.filter(pk=real.pk).exists()
