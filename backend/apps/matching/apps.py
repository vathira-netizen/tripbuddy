from django.apps import AppConfig


class MatchingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.matching'

    def ready(self):
        # Fail loudly at startup if the weights have been mistuned: a set that
        # does not sum to 1.0 yields scores that silently cannot reach 100%.
        from apps.matching.constants import validate_weights

        validate_weights()
