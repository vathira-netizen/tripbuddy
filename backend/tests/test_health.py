import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_endpoint_ok():
    response = APIClient().get("/api/health/")

    assert response.status_code == 200
    assert response.data["ok"] is True
    assert isinstance(response.data["db"], bool)
