from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.moderation.serializers import ReportSerializer


class ReportViewSet(mixins.CreateModelMixin, viewsets.GenericViewSet):
    """File a safety report. Create-only — reviewed via the Django admin."""

    serializer_class = ReportSerializer
    permission_classes = [IsAuthenticated]

    @extend_schema(summary="Report another traveller")
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)
