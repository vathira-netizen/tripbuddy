"""API error responses."""

from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    """DRF's handler, with a friendlier message when a limit is hit."""
    response = drf_exception_handler(exc, context)
    if isinstance(exc, Throttled) and response is not None:
        wait = int(exc.wait or 0)
        when = (
            "in a moment" if wait < 60
            else f"in about {round(wait / 60)} minute{'s' if round(wait / 60) != 1 else ''}"
        )
        response.data = {
            "detail": f"You're doing that too often. Please try again {when}.",
            "retry_after": wait,
        }
    return response
