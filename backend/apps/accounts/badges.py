"""Credibility badges shown on a traveller's profile.

Shared by every serializer that surfaces another traveller's public profile
(``PublicProfileSerializer``, ``ConnectionParticipantSerializer``,
``BuddyCandidateSerializer``) so the rules live in exactly one place.

Local imports of ``apps.trips``/``apps.connections`` models: both of those apps
already import ``apps.accounts``, so a module-level import here would be
circular.
"""

from django.db.models import Q


def compute_badges(profile) -> list[str]:
    from apps.connections.models import Connection
    from apps.trips.models import Trip

    badges = []
    if profile.email_verified:
        badges.append("email_verified")
    if profile.onboarded and profile.bio and profile.travel_styles:
        badges.append("profile_complete")

    is_active = Trip.objects.filter(
        Q(owner=profile.user) | Q(collaborators__user=profile.user)
    ).exists() or Connection.objects.filter(
        Q(requester=profile.user) | Q(addressee=profile.user),
        status=Connection.Status.ACCEPTED,
    ).exists()
    if is_active:
        badges.append("active_traveller")
    return badges
