"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/5.2/ref/settings/
"""

from pathlib import Path

import environ
import dj_database_url
import sys
import types


# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
# Read backend/.env if present (never committed; see .env.example).
environ.Env.read_env(BASE_DIR / ".env")


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env("DJANGO_SECRET_KEY", default="django-insecure-dev-only-change-me")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env.bool("DEBUG", default=False)

ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Render injects the service's public hostname here. Append it automatically so
# ALLOWED_HOSTS is correct without hand-typing the .onrender.com host: a blank or
# mismatched value returns 400 to Render's health-check probe, which surfaces as
# "Timed Out" on every deploy while the container is actually healthy.
_render_host = env("RENDER_EXTERNAL_HOSTNAME", default="")
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.gis",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "apps.accounts",
    "apps.destinations",
    "apps.matching",
    "apps.connections",
    "apps.trips",
    "apps.budgets",
    "apps.messaging",
    "apps.moderation",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases
# Supabase Postgres, configured via DATABASE_URL using the PostGIS backend.

# For local development without PostGIS/GDAL installed, fall back to SQLite.
# Deployments should use a real PostGIS DATABASE_URL.
DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        # Opening a connection to the Supabase pooler costs ~3s (TLS + auth +
        # PostGIS type registration) and every query ~0.13s round trip, so keep
        # connections for an hour and never add a per-request check query.
        # Idle drops are handled by the TCP keepalives below.
        conn_max_age=3600,
        engine="django.contrib.gis.db.backends.postgis",
    )
}
# TCP keepalives so an idle connection isn't silently dropped by NAT/the pooler.
DATABASES["default"].setdefault("OPTIONS", {}).update(
    keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3
)


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Django REST Framework

REST_FRAMEWORK = {
    # Supabase issues the JWT; Django verifies it on every request.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.SupabaseJWTAuthentication",
    ],
    # Locked down by default: an endpoint has to opt out explicitly (as
    # /api/health/ does) to be reachable without a token.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


# drf-spectacular (OpenAPI schema + /api/docs/)
#
# The docs pages are browsable without a token so the API can be explored, but
# they only *describe* the endpoints — every documented call still goes through
# SupabaseJWTAuthentication, so "Try it out" needs a real bearer token.

SPECTACULAR_SETTINGS = {
    "TITLE": "TripBuddy API",
    "DESCRIPTION": (
        "Budget-first travel planning: destinations, travel buddies, trips, "
        "itineraries and budgets. Authenticate with a Supabase access token "
        "sent as `Authorization: Bearer <token>`."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # budget_style is declared on both the profile and onboarding serializers;
    # pin one name so the generated enum isn't split into BudgetStyleEnum /
    # BudgetStyle1Enum.
    "ENUM_NAME_OVERRIDES": {
        "BudgetStyleEnum": "apps.common.choices.BudgetStyle",
    },
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
    # Endpoints live under /api/; drop that prefix from the displayed paths.
    "SCHEMA_PATH_PREFIX": "/api",
}


# Cookies and HTTPS (production only).
#
# The API itself is cookie-free — every call carries a Supabase bearer token —
# so these protect the session and CSRF cookies of /admin. Render terminates
# TLS and forwards plain HTTP, hence SECURE_PROXY_SSL_HEADER; no
# SECURE_SSL_REDIRECT, because Render's own health check calls in over HTTP.

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 8  # an admin session lasts a working day
X_FRAME_OPTIONS = "DENY"
# The admin login form posts back to the API host itself.
# A leading-dot host (".example.com") means any subdomain: "https://*.example.com".
CSRF_TRUSTED_ORIGINS = [
    "https://" + ("*" + host if host.startswith(".") else host)
    for host in ALLOWED_HOSTS
    if host not in ("*", "localhost", "127.0.0.1")
]


# django-cors-headers
# https://github.com/adamchainz/django-cors-headers

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])


# Supabase (auth / storage)
#
# SUPABASE_JWT_SECRET is the HS256 *signing secret* from
# Supabase > Settings > API > JWT Secret — NOT the service_role key, which is
# itself a JWT. apps.accounts.authentication verifies every bearer token with it.
#
# SUPABASE_SERVICE_ROLE_KEY bypasses Row-Level Security. It is server-side only
# and must never be exposed to the browser or prefixed NEXT_PUBLIC_.

SUPABASE_URL = env("SUPABASE_URL", default="")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", default="")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", default="")


# Buddy matching (apps.matching)
#
# The component weights themselves live in apps/matching/constants.py (they are
# a distribution that must stay coherent, not independent knobs). Only the
# default search radius is environment-tunable, so it can be widened for a
# sparse region without a deploy.

MATCH_DEFAULT_RADIUS_KM = env.int("MATCH_DEFAULT_RADIUS_KM", default=150)


# Nominatim / OpenStreetMap geocoding (apps.accounts.geocoding)
# Their usage policy requires an identifying User-Agent with contact details.

NOMINATIM_USER_AGENT = env(
    "NOMINATIM_USER_AGENT",
    default="TripBuddy/1.0 (student project; contact via repository)",
)

# --- AI itinerary generator (Phase 6) --------------------------------------
# The LLM is called server-side only (apps.trips.ai_service). The key must
# never be exposed to the browser — keep these out of any NEXT_PUBLIC var.
# Provider is swappable via env: point BASE_URL/MODEL/KEY at any
# OpenAI-compatible endpoint (Groq by default; e.g. Gemini's OpenAI-compat
# endpoint, xAI Grok, etc.) with no code change.
LLM_PROVIDER = env("LLM_PROVIDER", default="groq")
LLM_BASE_URL = env("LLM_BASE_URL", default="https://api.groq.com/openai/v1")
LLM_MODEL = env("LLM_MODEL", default="openai/gpt-oss-120b")
GROQ_API_KEY = env("GROQ_API_KEY", default="")
# Per-request timeout (seconds) for the LLM HTTP call.
LLM_TIMEOUT = env.int("LLM_TIMEOUT", default=30)
