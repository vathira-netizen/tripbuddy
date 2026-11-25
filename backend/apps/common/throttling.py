"""Request limits.

Two layers, both configured in settings.REST_FRAMEWORK:

* a generous per-user / per-IP ceiling on everything, as an abuse guard (it
  has to leave room for the chat and navbar polling a normal session does);
* ``WriteScopedThrottle`` for the few actions worth limiting on their own —
  sending messages, asking to join trips, posting reviews, and the AI calls,
  which also cost money per request. A view opts in with ``throttle_scope``.
"""

from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import ScopedRateThrottle


class WriteScopedThrottle(ScopedRateThrottle):
    """ScopedRateThrottle that only counts writes.

    Reading a chat (polled every few seconds) must not use up the budget for
    sending to it. Views without a ``throttle_scope`` are never limited here.
    """

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)

