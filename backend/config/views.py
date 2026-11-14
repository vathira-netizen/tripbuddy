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

    from django.conf import settings
    llm_ok = bool(settings.GROQ_API_KEY)
    body = {"ok": True, "db": db_ok, "llm_configured": llm_ok, "llm_key_len": len(settings.GROQ_API_KEY)}
    # ?llm=1 makes one tiny call to the provider with the server's real
    # settings and reports only the status and the provider's error text (never
    # the key), so a broken key/model can be diagnosed without logging in.
    # Opt-in so Render's frequent health checks never spend LLM quota.
    if request.query_params.get("llm") == "1" and llm_ok:
        body["llm_probe"] = _probe_llm(settings)
    return Response(body)


def _probe_llm(settings) -> dict:
    import requests

    url = f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions"
    try:
        resp = requests.post(
            url,
            json={
                "model": settings.LLM_MODEL,
                "messages": [{"role": "user", "content": 'Reply with {"ok": true}'}],
                "response_format": {"type": "json_object"},
                "max_tokens": 20,
            },
            headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
            timeout=20,
        )
    except requests.RequestException as exc:
        return {"model": settings.LLM_MODEL, "error": type(exc).__name__}
    result = {"model": settings.LLM_MODEL, "base_url": settings.LLM_BASE_URL, "status": resp.status_code}
    if resp.status_code != 200:
        try:
            err = resp.json().get("error", {})
            result["error"] = {"code": err.get("code"), "message": str(err.get("message"))[:300]}
        except ValueError:
            result["error"] = resp.text[:300]
    return result
