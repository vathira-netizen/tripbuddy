FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps for GeoDjango (GDAL/GEOS/PROJ) and psycopg build tools.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        binutils \
        libproj-dev \
        gdal-bin \
        libgeos-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

# Bind to $PORT when the platform sets one, else 8000.
#
# Render injects PORT (10000 by default) and health-checks *that* port. Binding
# 8000 unconditionally made the container come up healthy by its own reckoning
# while Render probed a port nothing was listening on, so every deploy failed
# with "Timed out waiting for internal health check" — the logs showing a
# perfectly good gunicorn the whole time. Locally PORT is unset and the
# fallback keeps 8000, so `docker run -p 8001:8000` is unchanged.
#
# Migrations run here rather than in a Render preDeployCommand, because
# pre-deploy commands require a paid instance type and the blueprint uses the
# free one (see render.yaml). `migrate` is idempotent, so the repeated starts a
# sleeping free instance causes are no-ops. If it fails the container does not
# start, which is the right outcome: a half-migrated database serving traffic is
# worse than a failed deploy. `exec` hands PID 1 to gunicorn so it gets signals.
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000}"]
