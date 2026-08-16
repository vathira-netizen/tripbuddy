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

# Migrations run at start-up rather than in a Render preDeployCommand, because
# pre-deploy commands require a paid instance type and the blueprint uses the
# free one (see render.yaml).
#
# `migrate` is idempotent, so the repeated starts a sleeping free instance
# causes are no-ops. If it fails the container does not start, which is the
# right outcome: a half-migrated database serving traffic is worse than a
# failed deploy. `exec` hands PID 1 to gunicorn so it receives signals.
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi:application --bind 0.0.0.0:8000"]
