from django.db import connections
from django.db.utils import OperationalError
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(request):
    db_ok = True
    try:
        connections["default"].cursor()
    except OperationalError:
        db_ok = False

    return Response({"ok": True, "db": db_ok})
