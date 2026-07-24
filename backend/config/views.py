from django.db import connections
from django.db.utils import OperationalError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])  # the default is IsAuthenticated; uptime checks have no token
def health(request):
    db_ok = True
    try:
        connections["default"].cursor()
    except OperationalError:
        db_ok = False

    return Response({"ok": True, "db": db_ok})
