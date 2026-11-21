from django.urls import path

from apps.messaging.views import (
    ClearConversationView,
    ConnectionMessagesView,
    MarkConversationReadView,
    TripChatClearView,
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
    path(
        "connections/<int:pk>/messages/clear/",
        ClearConversationView.as_view(),
        name="connection-messages-clear",
    ),
    path(
        "trips/<int:pk>/messages/clear/",
        TripChatClearView.as_view(),
        name="trip-messages-clear",
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
