import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _reset_request_limits():
    """Request-limit counters live in the cache; start every test at zero."""
    cache.clear()
    yield
    cache.clear()
