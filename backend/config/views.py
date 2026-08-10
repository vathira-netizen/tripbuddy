from django.db import connections
from django.db.utils import OperationalError
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@extend_schema(
    summary="Liveness/readiness probe",
    description="Used by Render's health check. `db` reports whether a database "
                "connection could be opened.",
    # A plain @api_view has no serializer for drf-spectacular to introspect.
    responses=OpenApiResponse(
        response=OpenApiTypes.OBJECT,
        description='`{"ok": true, "db": true}`',
    ),
    auth=[],
)
@api_view(["GET"])
@permission_classes([AllowAny])  # the default is IsAuthenticated; uptime checks have no token
def health(request):
    db_ok = True
    try:
        connections["default"].cursor()
    except OperationalError:
        db_ok = False

    return Response({"ok": True, "db": db_ok})
