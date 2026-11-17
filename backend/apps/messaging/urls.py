from django.urls import path

from apps.messaging.views import (
    ConnectionMessagesView,
    MarkConversationReadView,
    TripChatListView,
    TripChatReadView,
    TripMessagesView,
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
    path("trips/<int:pk>/messages/", TripMessagesView.as_view(), name="trip-messages"),
    path(
        "trips/<int:pk>/messages/read/",
        TripChatReadView.as_view(),
        name="trip-messages-read",
    ),
    path("trip-chats/", TripChatListView.as_view(), name="trip-chats"),
    path("messages/summary/", UnreadSummaryView.as_view(), name="messages-summary"),
]
