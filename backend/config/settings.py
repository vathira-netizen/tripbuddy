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
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
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

DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        # Local fallback only; real deployments always set DATABASE_URL to
        # the Supabase Postgres connection string (see .env.example).
        default="postgres://postgres:postgres@localhost:5432/tripbuddy",
        conn_max_age=600,
        engine="django.contrib.gis.db.backends.postgis",
    )
}


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
# OpenAI-compatible endpoint (Grok by default; e.g. Gemini's OpenAI-compat
# endpoint) with no code change.
LLM_PROVIDER = env("LLM_PROVIDER", default="grok")
LLM_BASE_URL = env("LLM_BASE_URL", default="https://api.x.ai/v1")
LLM_MODEL = env("LLM_MODEL", default="grok-2-latest")
GROK_API_KEY = env("GROK_API_KEY", default="")
# Per-request timeout (seconds) for the LLM HTTP call.
LLM_TIMEOUT = env.int("LLM_TIMEOUT", default=30)
