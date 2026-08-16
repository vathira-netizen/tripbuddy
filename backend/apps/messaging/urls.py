from django.urls import path

from apps.messaging.views import (
    ConnectionMessagesView,
    MarkConversationReadView,
    UnreadSummaryView,
)

urlpatterns = [
    path(
        "connections/<int:pk>/messages/",
        ConnectionMessagesView.as_view(),
        name="connection-messages",
    ),
    path(
        "connections/<int:pk>/messages/read/",
        MarkConversationReadView.as_view(),
        name="connection-messages-read",
    ),
    path("messages/summary/", UnreadSummaryView.as_view(), name="messages-summary"),
]
